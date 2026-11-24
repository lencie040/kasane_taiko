'use strict';

function createKasaneEditor(game) {
  const { pane } = game;
  const tools = [
    ['select','選択','1'], ['don','ドン','2'], ['ka','カッ','3'], ['roll','連打','4'],
    ['balloon','風船','5'], ['bigDon','大ドン','6'], ['bigKa','大カッ','7'],
    ['bigRoll','大連打','8'], ['seal','封印','9'], ['erase','消去','0'],
  ];
  const courses = Object.keys(game.courseInfo);
  const initialTiming = () => [{ time:0, value:500, meter:4, inherited:false, effects:0 }];
  const newDraft = () => ({
    meta:{ title:'', artist:'', creator:'', version:'おに', course:'oni', file:'' },
    timing:initialTiming(), objects:[], audioFile:null, sourceUid:null, sourceText:'', snap:4, od:5,
    key:'editor:'+(crypto.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2)),
    newDifficulty:false,folders:[],
  });
  let draft = newDraft(), original = null, buffer = null, wave = null, audioJob = 0, sourceAudio = null;
  let coverJob=0, coverBusy=false, coverPreviewUrl=null;
  let nextId = 1, tool = 'don', cursor = 0, start = 0, span = 6000, timingIndex = 0;
  let selection = new Set(), history = [], future = [], clipboard = [], dirty = false;
  let pending = null, gesture = null, geometry, playing = null, raf = 0, lastTick = 0, estimate = null;
  let quoted = null, quoteDrag = null;
  let librarySignature='', librarySongs=[], librarySetKey='', libraryChartUid='';
  let ratingFrame=0;

  pane.innerHTML = `
    <div class="ed-heading">
      <div><h2>エディットモード</h2><p id="edProject"></p></div>
      <div class="ed-actions"><button id="edNew" class="btn">新規譜面</button><button id="edSave" class="btn">下書きを保存</button><button id="edRestore" class="btn">下書きを開く</button></div>
    </div>
    <div class="ed-card ed-source">
      <button class="btn primary" id="edBrowse" aria-haspopup="dialog">既存譜面を選ぶ</button>
      <label class="btn gold ed-upload">音源を選ぶ<input id="edAudio" type="file" accept="audio/*,.mp3,.ogg,.wav,.m4a,.aac,.flac,.opus,.webm"></label>
      <span id="edAudioName"></span>
    </div>
    <dialog id="edLibrary" class="ed-library" aria-labelledby="edLibraryTitle">
      <div class="ed-heading">
        <h3 id="edLibraryTitle">既存譜面を選ぶ</h3>
        <button class="btn small" id="edLibraryClose">閉じる</button>
      </div>
      <label class="ed-wide ed-library-search">検索
        <input id="edLibrarySearch" type="search" placeholder="曲名・作者・難易度" autocomplete="off">
      </label>
      <div class="ed-library-grid">
        <fieldset>
          <legend>曲 <small id="edLibraryCount" aria-live="polite"></small></legend>
          <div id="edLibrarySongs" class="ed-library-list"></div>
        </fieldset>
        <fieldset>
          <legend>難易度</legend>
          <div id="edLibraryCharts" class="ed-library-list"></div>
        </fieldset>
      </div>
      <div class="ed-actions ed-library-actions">
        <button class="btn primary" id="edOpen" disabled>譜面を開く</button>
        <button class="btn" id="edNewDiff" disabled>同じ曲に新規譜面</button>
      </div>
    </dialog>
    <details class="ed-card" id="edMetadata" open><summary>曲・譜面情報</summary>
      <div class="ed-meta">
        <label>曲名<input id="edTitle" autocomplete="off"></label>
        <label>アーティスト<input id="edArtist" autocomplete="off"></label>
        <label>譜面作者<input id="edCreator" autocomplete="off"></label>
        <label>難易度名<input id="edVersion" autocomplete="off"></label>
        <label>コース<select id="edCourse"></select></label>
        <label>推定レベル<output id="edLevel">—</output></label>
        <label>出力名<input id="edFilename" placeholder="曲名"></label>
      </div>
      <fieldset id="edSealed" class="ed-folders" hidden>
        <legend>封印譜面の解禁条件</legend>
        <p>移行元と同じ音源を使います。解禁後は、この譜面を最初から遊べます。</p>
        <div class="ed-meta">
          <label>移行元の通常譜面<select id="edSealedSource"></select></label>
          <label>移行位置（ms）<input id="edSealedAt" type="number" min="1" step="1" required></label>
          <button class="btn" id="edSealedHere" type="button">現在の再生位置を使う</button>
          <label>キャラクター<select id="edSealedCharacter"></select></label>
          <label>キャラクター Lv 以上<input id="edSealedMinLevel" type="number" min="1" max="100" step="1" required></label>
          <label>不可の上限<input id="edSealedMaxBad" type="number" min="0" step="1" required></label>
          <label>可の上限<input id="edSealedMaxOk" type="number" min="0" step="1" required></label>
        </div>
      </fieldset>
      <div class="ed-cover-controls">
        <div id="edCoverPreview" aria-label="ジャケ絵のプレビュー"></div>
        <label class="btn ed-upload">ジャケ絵を選ぶ<input id="edCover" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp,.gif,.avif"></label>
        <button id="edCoverRemove" class="btn small" type="button" disabled>ジャケ絵を外す</button>
      </div>
      <details class="ed-rating"><summary>難易度の内訳</summary>
        <p>表示レベルに換算する前の各項目の加点</p><dl id="edRatingBreakdown"></dl>
      </details>
      <fieldset class="ed-folders"><legend>所属フォルダ（複数選択可）</legend><div id="edFolders"></div></fieldset>
    </details>
    <div class="ed-card ed-compose">
      <div class="ed-transport">
        <button id="edPlay" class="btn primary">再生</button>
        <button id="edHome" class="btn">先頭</button>
        <label><input id="edMetro" type="checkbox"> メトロノーム</label>
        <label><input id="edHits" type="checkbox" checked> ノーツ音</label>
        <output id="edTime"></output>
        <label>スナップ<select id="edSnap"></select></label>
        <label>表示幅<select id="edZoom"><option value="2000">2秒</option><option value="4000">4秒</option><option value="6000" selected>6秒</option><option value="12000">12秒</option><option value="24000">24秒</option></select></label>
      </div>
      <div id="edTools" class="ed-tools" role="group" aria-label="配置ツール"></div>
      <div class="ed-transport ed-editline">
        <button id="edUndo" class="btn small">元に戻す</button><button id="edRedo" class="btn small">やり直す</button>
        <button id="edDelete" class="btn small">選択を削除</button>
        <label>封印する側<select id="edSeal"><option value="left">左手</option><option value="right">右手</option><option value="">解除</option></select></label>
        <span id="edToolHelp"></span>
      </div>
      <canvas id="edTimeline" tabindex="0" aria-label="波形と4段の譜面タイムライン"></canvas>
      <input id="edSeek" type="range" min="0" max="120000" step="1" value="0" aria-label="曲全体の再生位置">
      <p id="edSelection" class="ed-selection"></p>
    </div>
    <details class="ed-card" id="edQuote"><summary>譜面を引用</summary>
      <div class="ed-quote-source">
        <label class="ed-wide">引用元の曲<select id="edQuoteSet"></select></label>
        <label class="ed-wide">難易度<select id="edQuoteChart"></select></label>
      </div>
      <canvas id="edQuoteTimeline" aria-label="引用範囲のプレビュー。ドラッグして範囲を選択"></canvas>
      <div class="ed-transport">
        <label>開始（秒）<input id="edQuoteFrom" type="number" min="0" step=".001" value="0"></label>
        <label>終了（秒）<input id="edQuoteTo" type="number" min="0" step=".001" value="0"></label>
        <button id="edQuoteAll" class="btn">全区間</button><button id="edQuoteInsert" class="btn gold">再生位置に引用</button>
      </div>
      <p>元の範囲をドラッグして選択します。拍の間隔を引用先のBPMに合わせます。</p>
    </details>
    <div class="ed-panels">
      <section class="ed-card">
        <h3>タイミング</h3>
        <div class="ed-actions"><button id="edMeasure" class="btn gold">BPM自動測定</button>
          <button id="edApplyTempo" class="btn" hidden>推定値を適用</button></div>
        <p id="edTempoResult" aria-live="polite"></p>
        <label class="ed-wide">タイミング点<select id="edTimingList"></select></label>
        <div class="ed-fields">
          <label>開始位置 (ms)<input id="edOffset" type="number" step="0.001"></label>
          <label>BPM<input id="edBpm" type="number" min="1" max="1000" step="0.01"></label>
          <label>拍子<select id="edMeter"></select></label>
          <label><input id="edKiai" type="checkbox"> ゴーゴー</label>
        </div>
        <div class="ed-actions"><button id="edTimingApply" class="btn">選択点に反映</button>
          <button id="edTimingAdd" class="btn">再生位置に追加</button><button id="edTimingRemove" class="btn">選択点を削除</button></div>
      </section>
      <section class="ed-card">
        <h3>試遊・書き出し</h3>
        <div class="ed-actions"><button id="edTest" class="btn">ゲームで試遊</button><button id="edExport" class="btn primary">.ktzを書き出す</button><button id="edSaveSeal" class="btn" hidden>元の譜面に封印を反映</button></div>
        <p>曲名・難易度・封印は .ktz に含まれます。配信するときは content/songs/ に置いてください。</p>
      </section>
    </div>
    <details class="ed-card"><summary>ショートカット</summary>
      <p>Space 再生／一時停止、← → ひと目盛り移動、Shift＋← → 1拍移動、Shift＋数字 スナップ変更、1〜9／0 ツール選択。選択ツールでドラッグ移動、Shift＋クリックで複数選択、Altでスナップなし。右クリックまたはDeleteで削除。Ctrl／⌘＋Z・Yで元に戻す・やり直す、A・C・X・Vで全選択・コピー・切り取り・貼り付け。</p>
    </details>
    <p id="edStatus" role="status" aria-live="polite"></p>`;
  const field = name => pane.querySelector('#ed' + name);
  const canvas = field('Timeline'), ctx = canvas.getContext('2d');
  const metadata = { Title:'title', Artist:'artist', Creator:'creator', Version:'version', Course:'course', Filename:'file' };
  const ratingParts = [
    ['quantity','物量'], ['technique','技術'], ['rhythm','リズム'],
    ['visibility','視認性'], ['simultaneous','同時押し'], ['sealed','封印ノーツ'],
  ];
  const clean = value => String(value ?? '').replace(/[\r\n\u0000]/g,' ').trim();
  const fileSafe = value => clean(value).replace(/[\\/:*?"<>|]/g,'_').replace(/^[.\s]+|[.\s]+$/g,'').slice(0,130);
  const fileName = () => fileSafe(draft.meta.file.replace(/\.ktz$/i,'') || clean(draft.meta.title)) || '新規譜面';
  const say = (message, error=false) => {
    const status = field('Status');
    status.textContent=message;status.classList.toggle('ed-error',error);
  };
  const opt = (value,label) => new Option(label,value);
  for (const key of courses) field('Course').add(opt(key, game.courseInfo[key].jp));
  const splits = [1,2,3,4,5,6,7,8,9,12,16,0];
  for (const div of splits) field('Snap').add(opt(div,div?`${4*div}分（1/${div}拍）`:'なし'));
  for (const value of [1,2,3,4,5,6,7,8,9,12,16]) field('Meter').add(opt(value,`${value}/4`));
  for (const [key,label,shortcut] of tools) {
    const button=document.createElement('button');
    button.type='button';button.className='btn small';
    button.dataset.tool=key;button.textContent=`${label} ${shortcut}`;
    button.addEventListener('click',()=>selectTool(key));
    field('Tools').append(button);
  }
  const sorted = () => [...draft.objects].sort((a,b)=>a.t-b.t||a.lane-b.lane||a.id-b.id);
  const reds = () => draft.timing.filter(p=>!p.inherited);
  function pointAt(t, points=reds()) {
    let result=points[0];
    for (const point of points) { if(point.time>t)break; result=point; }
    return result;
  }
  const length = () => Math.max(buffer?Math.ceil(buffer.duration*1000):draft.objects.length?8000:120000,
    draft.objects.reduce((end,n)=>Math.max(end,n.end??n.t),0),
    draft.timing.at(-1).time+1000);
  function snap(t,free=false) {
    const point=pointAt(t),step=point.value/draft.snap;
    const next=reds().find(p=>p.time>t);
    const value=free||!draft.snap?t:Math.min(next?.time??Infinity,point.time+Math.round((t-point.time)/step)*step);
    return Math.round(Math.max(0,Math.min(length(),value)));
  }
  const clock = t => `${Math.floor(t/60000)}:${String(Math.floor(t/1000)%60).padStart(2,'0')}.${String(Math.floor(t)%1000).padStart(3,'0')}`;
  function moveView(t, center=false) {
    cursor=Math.min(length(),Math.max(0,t));
    if(center||cursor<start||cursor>start+span*.87)start=cursor-span*(center ? .35 : .22);
    start=Math.max(0,Math.min(start,length()-span));
  }
  function seek(t,center=false) {
    const wasPlaying=!!playing;
    pause();
    moveView(t,center);draw();
    if(wasPlaying)play();
  }
  function selectTool(value) {
    tool=value;pending=null;
    for(const button of field('Tools').children)button.setAttribute('aria-pressed',String(button.dataset.tool===value));
    field('ToolHelp').textContent=value==='select'?'クリックで選択、ドラッグで移動。':value==='seal'?'封印する音符をクリック。':
      /roll|balloon/i.test(value)?'始点と終点をクリック、または横にドラッグ。':value==='erase'?'消したい音符をクリック。':'目盛りをクリックして配置。同じ時刻の別段に置くと重ねノーツになります。';
    draw();
  }
  const snapshot = () => ({
    objects:draft.objects.map(o=>({...o})),
    timing:draft.timing.map(p=>({...p})),
  });
  function checkpoint() {
    history.push(snapshot());
    if(history.length>80)history.shift();
    future=[];
  }
  function mark() {dirty=true;refresh();queueRating();draw();}
  function restoreHistory(from,to) {
    if(!from.length)return;
    to.push(snapshot());Object.assign(draft,from.pop());
    selection.clear();pending=null;timingIndex=0;syncTiming();
    mark();
  }
  const groups = objects => {
    const out=new Map();
    for(const o of objects)if(o.type==='note'){
      if(!out.has(o.t))out.set(o.t,[]);
      out.get(o.t).push(o);
    }
    return out;
  };
  function canSeal(notes) {
    return notes?.length===1||(notes?.length===2&&!notes.some(o=>o.big)&&notes[0].color!==notes[1].color);
  }
  function validate(objects) {
    const groupsByTime=groups(objects);
    const times=[...groupsByTime.keys()].sort((a,b)=>a-b);
    for(let i=0;i<times.length;i++) {
      if(i&&times[i]-times[i-1]<=2)return '単音と別の時刻に置くには3 ms以上離してください。重ねる場合は時刻をそろえます。';
      const notes=groupsByTime.get(times[i]);
      if(new Set(notes.map(n=>n.lane)).size!==notes.length)return '同じ段・同じ時刻には1つだけ置けます。';
      for(const type of ['d','k']){
        if(notes.reduce((sum,n)=>sum+(n.color===type?(n.big?2:1):0),0)>2)return '同時押しはドン・カッそれぞれ2入力までです。大音符は2入力として数えます。';
      }
      if(notes.some(o=>o.seal)&&!canSeal(notes))return '封印付きの同時押しは小ドン1個＋小カッ1個までです。';
    }
    const durations=objects.filter(o=>o.type!=='note');
    if(durations.some(o=>o.end-o.t<(o.type==='balloon'?100:40)))return '連打は40 ms以上、風船は100 ms以上にしてください。';
    return '';
  }
  function commit(objects) {
    const error=validate(objects);
    if(error){say(error,true);return false;}
    checkpoint();draft.objects=objects;mark();return true;
  }
  function remove(ids) {
    const remaining=draft.objects.filter(o=>!ids.has(o.id));
    if(remaining.length===draft.objects.length)return;
    selection.clear();commit(remaining);
  }
  function placeNote(t,lane) {
    const old=draft.objects.find(o=>o.type==='note'&&o.t===t&&o.lane===lane);
    const note={id:old?.id??nextId++,type:'note',t,lane,color:/ka/i.test(tool)?'k':'d',big:tool.startsWith('big'),seal:old?.seal??''};
    if(commit([...draft.objects.filter(o=>o!==old),note])){
      selection=new Set([note.id]);game.hit(note.color==='d'?'don':'ka');refreshSelection();draw();
    }
  }
  function placeDuration(a,b,lane) {
    const o={id:nextId++,type:tool==='balloon'?'balloon':'roll',t:Math.min(a,b),end:Math.max(a,b),lane,big:tool==='bigRoll'};
    if(commit([...draft.objects,o])){selection=new Set([o.id]);refreshSelection();draw();}
  }
  const durationTool = () => /roll|balloon/i.test(tool);
  function updateSeal(o) {
    if(o?.type!=='note'){say('封印するドンかカッを選んでください。',true);return;}
    const choice=field('Seal').value;
    const seal=o.seal===choice?'':choice;
    commit(draft.objects.map(n=>n===o?{...n,seal}:n));
  }
  function refreshSelection() {
    const selected=draft.objects.filter(o=>selection.has(o.id));
    const one=selected[0];
    field('Selection').textContent=selected.length===1?`選択中  ${clock(one.t)} ・ ${one.lane+1}段目${one.end!=null?` ・ ${Math.round(one.end-one.t)} ms`:''}${one.seal?` ・ ${one.seal==='left'?'左手':'右手'}封印`:''}`:
      selected.length?`${selected.length}個を選択中`:`${draft.objects.length}個のオブジェクト`;
    field('Delete').disabled=!selected.length;
  }
  const sealedNumbers={At:'at',MinLevel:'minLevel',MaxBad:'maxBad',MaxOk:'maxOk'};
  function sealedSources() {
    if(!original||original.set.demo)return [];
    return original.set.charts.filter(c=>SealedRoute.ordinary(c)&&(draft.newDifficulty||c!==original));
  }
  function sealedSource() {
    return sealedSources().find(c=>game.nk(c.sourcePath)===game.nk(draft.sealedRoute?.sourcePath));
  }
  function syncSealed() {
    const route=draft.sealedRoute;
    const sources=sealedSources();
    const source=field('SealedSource');
    source.replaceChildren(...sources.map(c=>opt(c.sourcePath,`${c.meta.version} ・ ${game.levelText(c)}`)));
    source.value=sealedSource()?.sourcePath||'';
    const character=field('SealedCharacter');
    const chars=game.characters();
    character.replaceChildren(opt('','キャラクターなし'),...chars.map(c=>opt(c.id,c.name)));
    if(route?.character&&!chars.some(c=>c.id===route.character))character.add(opt(route.character,route.character));
    character.value=route?.character??'';
    for(const [id,key] of Object.entries(sealedNumbers))field('Sealed'+id).value=route?.[key]??'';
  }
  function refresh() {
    const stacked=[...groups(draft.objects).values()].some(notes=>notes.length>1);
    const sealed=draft.meta.course==='sealed';
    const course=stacked&&!sealed?'kasane':draft.meta.course;
    field('Course').disabled=stacked&&!sealed&&!sealedSources().length;
    field('Sealed').hidden=!sealed;
    field('SealedMinLevel').disabled=!draft.sealedRoute?.character;
    field('Audio').disabled=sealed;
    field('Audio').closest('label').hidden=sealed;
    field('Course').value=course;
    field('Project').textContent=(original?`${original.set.title} / ${draft.newDifficulty?'新規譜面':original.meta.version}`:'新規譜面')+(dirty?' ・ 未保存':'');
    field('AudioName').textContent=buffer?`${(sealed?sealedSource()?.audio:draft.audioFile?.name||original?.audio)||'デモ音源'} ・ ${clock(buffer.duration*1000)}`:'音源なし';
    field('Play').disabled=!buffer;
    field('Measure').disabled=!buffer;
    field('Test').disabled=!buffer||!draft.objects.length;
    field('Export').disabled=!buffer||!draft.objects.length;
    field('SaveSeal').hidden=!original||draft.newDifficulty;
    field('Undo').disabled=!history.length;field('Redo').disabled=!future.length;
    refreshSelection();
  }
  function syncFields() {
    for(const [id,key] of Object.entries(metadata))field(id).value=draft.meta[key];
    field('Snap').value=draft.snap;
    syncTiming();syncSealed();renderFolderOptions();refresh();
  }
  function syncTiming() {
    const points=reds();
    const list=field('TimingList');
    list.replaceChildren(...points.map(p=>opt(p.time,`${p.time} ms ・ ${(60000/p.value).toFixed(2)} BPM`)));
    timingIndex=Math.min(timingIndex,points.length-1);
    list.selectedIndex=timingIndex;
    const point=points[timingIndex];
    field('Offset').value=point.time;field('Bpm').value=Number((60000/point.value).toFixed(8));
    field('Meter').value=point.meter;
    field('Kiai').checked=!!(point.effects&1);
    field('TimingRemove').disabled=points.length<=1;
  }
  function changeTiming(add) {
    const point=reds()[timingIndex];
    const time=add?Math.round(cursor):Number(field('Offset').value);
    const bpm=Number(field('Bpm').value);
    if(!Number.isFinite(time)||time<-60000||time>7200000||!(bpm>=1&&bpm<=1000)){
      say('開始位置とBPM（1〜1000）を確認してください。',true);return;
    }
    checkpoint();
    const slot=draft.timing.find(p=>!p.inherited&&p.time===time);
    const previous=slot||(add?null:point);
    draft.timing=draft.timing.filter(p=>p!==previous&&(add||p!==point));
    const row={...previous,time,value:60000/bpm,meter:Number(field('Meter').value)||4,inherited:false,
      effects:(previous?.effects??0)&~1 | Number(field('Kiai').checked),raw:null};
    draft.timing.push(row);draft.timing.sort((a,b)=>a.time-b.time||a.inherited-b.inherited);
    timingIndex=reds().indexOf(row);syncTiming();mark();
  }

  function draw() {
    if(pane.hidden)return;
    const width=canvas.clientWidth,height=canvas.clientHeight;
    if(!width||!height)return;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const left=38, right=width-12, lanesTop=78, laneHeight=(height-lanesTop-10)/4;
    const toX=t=>left+(t-start)/span*(right-left);
    geometry={left,right,lanesTop,laneHeight,toX};
    ctx.fillStyle='#1b162b';ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#302444';ctx.fillRect(left,20,right-left,51);
    for(let lane=0;lane<4;lane++){
      ctx.fillStyle=lane%2?'#262039':'#2d2441';
      ctx.fillRect(left,lanesTop+lane*laneHeight,right-left,laneHeight-1);
      ctx.fillStyle='#ceb9d9';ctx.font='12px system-ui,sans-serif';
      ctx.fillText(String(lane+1),16,lanesTop+(lane+.5)*laneHeight+4);
    }
    ctx.save();ctx.beginPath();ctx.rect(left,0,right-left,height);ctx.clip();
    if(wave&&buffer){
      const duration=buffer.duration*1000;
      ctx.strokeStyle='#c385c5';ctx.beginPath();
      for(let x=left;x<=right;x++){
        const i=Math.floor((start+(x-left)/(right-left)*span)/duration*wave.length);
        const value=wave[i]||0;
        ctx.moveTo(x,45-value*23);ctx.lineTo(x,45+value*23);
      }
      ctx.stroke();
    }
    const points=reds(), split=draft.snap||1;
    ctx.font='11px system-ui,sans-serif';
    for(let i=0;i<points.length;i++){
      const p=points[i],step=p.value/split;
      const begin=i===0?start:Math.max(start,p.time);
      const end=Math.min(start+span,points[i+1]?.time??Infinity);
      const every=Math.max(1,Math.ceil(5/((right-left)*step/span)));
      for(let tick=Math.ceil((begin-p.time)/step-1e-8);p.time+tick*step<end+.0001;tick++){
        const bar=tick%(split*p.meter)===0,beat=tick%split===0;
        if(!beat&&tick%every!==0)continue;
        const t=p.time+tick*step,x=toX(t);
        ctx.fillStyle=bar?'#d2a57a':beat?'#a286a9':'#ffffff1c';
        ctx.fillRect(x,bar?19:lanesTop,bar?2:1,height-(bar?28:lanesTop+10));
        if(bar){ctx.fillStyle='#f3ded2';ctx.fillText(clock(Math.max(0,t)).slice(0,-4),x+4,15);}
      }
      if(p.time>=start&&p.time<=start+span){
        ctx.fillStyle='#ff796e';ctx.fillRect(toX(p.time),18,2,53);
      }
    }
    if(draft.meta.course==='sealed'&&draft.sealedRoute?.at>0){
      const x=toX(draft.sealedRoute.at);
      ctx.fillStyle='#ca97ff';ctx.fillRect(x,18,2,height-28);
      ctx.font='bold 11px system-ui,sans-serif';ctx.fillText('封印へ移行',x+4,32);
    }
    const list=gesture?.moving?gesture.projected:draft.objects;
    const stacks=groups(list);
    for(const [t,notes] of stacks){
      if(notes.length<2||t<start||t>start+span)continue;
      const lanes=notes.map(n=>n.lane);
      const x=toX(t),y=lanesTop+(Math.min(...lanes)+.5)*laneHeight;
      ctx.fillStyle='#ffd57e';ctx.fillRect(x-2,y,4,(Math.max(...lanes)-Math.min(...lanes))*laneHeight);
    }
    for(const o of list){
      if((o.end??o.t)<start-80||o.t>start+span+80)continue;
      const x=toX(o.t),y=lanesTop+(o.lane+.5)*laneHeight,r=o.big?13:9;
      const selected=selection.has(o.id);
      ctx.beginPath();
      if(o.type==='note')ctx.arc(x,y,r,0,2*Math.PI);
      else {
        const end=toX(o.end);
        if(ctx.roundRect)ctx.roundRect(x-r,y-r,Math.max(2,end-x)+r*2,r*2,r);
        else ctx.rect(x-r,y-r,Math.max(2,end-x)+r*2,r*2);
      }
      ctx.fillStyle=o.type==='roll'?'#f5b84b':o.type==='balloon'?'#d88bf0':o.color==='d'?'#fc7264':'#50cbee';
      ctx.fill();ctx.strokeStyle=selected?'#fff491':'#fff2e5';ctx.lineWidth=selected?3:1.6;ctx.stroke();
      if(o.seal){
        ctx.beginPath();const a=o.seal==='left'?Math.PI/2:-Math.PI/2;
        ctx.arc(x,y,r-.5,a,a+Math.PI);ctx.closePath();
        ctx.fillStyle='#34152d';ctx.fill();ctx.strokeStyle='#ff94bd';ctx.lineWidth=1.5;ctx.stroke();
      }
    }
    if(pending!=null){ctx.fillStyle='#ffc468';ctx.fillRect(toX(pending.time),lanesTop,2,height-lanesTop-10);}
    ctx.fillStyle='#fff0ff';ctx.fillRect(toX(cursor),18,2,height-28);
    ctx.restore();
    field('Time').value=clock(cursor);
    field('Seek').max=length();field('Seek').value=cursor;
  }
  function coordinate(event) {
    const box=canvas.getBoundingClientRect(),g=geometry;
    const x=event.clientX-box.left,y=event.clientY-box.top;
    return {x,y,time:start+(x-g.left)/(g.right-g.left)*span,
      lane:Math.min(3,Math.max(0,Math.floor((y-g.lanesTop)/g.laneHeight)))};
  }
  function objectAt(co) {
    const g=geometry,end=g.right;
    let best=null,dist=Infinity;
    for(const o of draft.objects){
      if(o.lane!==co.lane)continue;
      const x=g.toX(o.t),r=o.big?13:9,ex=g.toX(o.end??o.t);
      if(co.x<x-r-4||co.x>ex+r+4||co.x>end+4)continue;
      const dx=Math.max(0,x-co.x,co.x-ex);
      if(dx<dist){best=o;dist=dx;}
    }
    return best;
  }
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0||!geometry)return;
    const co=coordinate(e),g=geometry;
    if(co.x<g.left||co.x>g.right)return;
    canvas.focus({preventScroll:true});
    if(co.y<g.lanesTop){seek(snap(co.time,e.altKey));return;}
    if(playing)pause();
    const t=snap(co.time,e.altKey),o=objectAt(co);
    cursor=t;
    if(tool==='seal'){updateSeal(o);draw();return;}
    if(tool==='erase'){if(o)remove(new Set([o.id]));draw();return;}
    if(tool==='select'){
      if(!e.shiftKey&&!selection.has(o?.id))selection.clear();
      if(o){
        const removed=e.shiftKey&&selection.delete(o.id);
        if(!removed){
          selection.add(o.id);
          const edge=o.end!=null&&selection.size===1&&Math.abs(co.x-g.toX(o.end))<9?'end':null;
          gesture={id:e.pointerId,co,anchor:o,edge,moving:false};
        }
      }
      refreshSelection();draw();
    }else if(durationTool()){
      gesture={id:e.pointerId,co,t,duration:true};
      draw();
    }else {placeNote(t,co.lane);draw();}
    if(gesture)canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(e.pointerId!==gesture?.id||gesture.duration)return;
    const co=coordinate(e),anchor=gesture.anchor;
    if(!gesture.moving&&Math.hypot(co.x-gesture.co.x,co.y-gesture.co.y)<5)return;
    const shift=gesture.edge?0:snap(anchor.t+co.time-gesture.co.time,e.altKey)-anchor.t;
    const earliest=Math.min(...draft.objects.filter(o=>selection.has(o.id)).map(o=>o.t));
    const dt=Math.max(-earliest,shift),laneShift=co.lane-gesture.co.lane;
    gesture.moving=true;gesture.projected=draft.objects.map(o=>{
      if(!selection.has(o.id))return o;
      const copy={...o,t:o.t+dt,lane:Math.min(3,Math.max(0,o.lane+laneShift))};
      if(o.end!=null)copy.end=gesture.edge?snap(o.end+co.time-gesture.co.time,e.altKey):o.end+dt;
      return copy;
    });
    draw();
  });
  canvas.addEventListener('pointerup',e=>{
    if(e.pointerId!==gesture?.id)return;
    const item=gesture;gesture=null;
    if(item.duration){
      const co=coordinate(e),t=snap(co.time,e.altKey);
      if(Math.abs(item.co.x-co.x)>=6){pending=null;placeDuration(item.t,t,item.co.lane);}
      else if(pending==null)pending={time:item.t,lane:item.co.lane};
      else {placeDuration(pending.time,item.t,pending.lane);pending=null;}
    }else if(item.moving)commit(item.projected);
    draw();
  });
  canvas.addEventListener('pointercancel',()=>{gesture=null;draw();});
  canvas.addEventListener('contextmenu',event=>{
    event.preventDefault();
    if(pending!=null){pending=null;draw();return;}
    if(!geometry)return;
    const co=coordinate(event);
    if(co.y>=geometry.lanesTop){const o=objectAt(co);if(o)remove(new Set([o.id]));}
  });
  canvas.addEventListener('wheel',e=>{
    if(!e.deltaY)return;
    e.preventDefault();
    if(e.altKey){
      const zoom=field('Zoom');
      zoom.selectedIndex=Math.min(zoom.options.length-1,Math.max(0,zoom.selectedIndex+Math.sign(e.deltaY)));
      span=Number(zoom.value);moveView(cursor,true);draw();
    }else stepCursor(-Math.sign(e.deltaY),e.shiftKey);
  },{passive:false});
  function stepCursor(direction,beat=false) {
    const point=pointAt(cursor);
    seek(snap(cursor+direction*point.value/(beat?1:draft.snap||4)));
  }

  function resetPlaybackTimeline() {
    lastTick=cursor-1;
    if(playing)playing.notes=sorted();
  }
  function play() {
    if(!buffer||playing)return;
    const ac=game.audio();
    if(cursor>=buffer.duration*1000)moveView(0);
    const source=ac.createBufferSource(),gain=ac.createGain();
    source.buffer=buffer;gain.gain.value=.8;
    source.connect(gain);gain.connect(ac.destination);
    playing={source,ac,at:ac.currentTime,from:cursor,notes:[]};
    resetPlaybackTimeline();
    source.start(0,cursor/1000);
    field('Play').textContent='一時停止';raf=requestAnimationFrame(tick);
  }
  function pause() {
    if(!playing)return;
    const {source,ac,at,from}=playing;
    playing=null;cancelAnimationFrame(raf);raf=0;
    moveView(Math.min(buffer?.duration*1000??length(),from+(ac.currentTime-at)*1000));
    try{source.stop();}catch(e){}
    field('Play').textContent='再生';draw();
  }
  function tick() {
    if(!playing)return;
    const {ac,at,from,notes}=playing;
    const now=from+(ac.currentTime-at)*1000;
    if(now>=buffer.duration*1000){pause();return;}
    if(field('Metro').checked){
      const point=pointAt(now);
      const beat=Math.floor((now-point.time)/point.value);
      const t=point.time+beat*point.value;
      if(t>lastTick&&t<=now)game.hit(beat%point.meter===0?'don':'ka');
    }
    if(field('Hits').checked){
      for(const o of notes){
        if(o.t>now)break;
        if(o.t>lastTick&&o.type==='note')game.hit(o.color==='d'?'don':'ka');
      }
    }
    lastTick=now;moveView(now);draw();
    raf=requestAnimationFrame(tick);
  }
  function setBuffer(value) {
    buffer=value;wave=null;estimate=null;
    field('ApplyTempo').hidden=true;field('TempoResult').textContent='';
    if(value){
      const channel=value.getChannelData(0);
      wave=new Float32Array(Math.min(16000,channel.length));
      for(let i=0;i<wave.length;i++){
        let peak=0;
        const first=Math.floor(i*channel.length/wave.length),last=Math.floor((i+1)*channel.length/wave.length);
        const jump=Math.max(1,Math.floor((last-first)/100));
        for(let j=first;j<last;j+=jump)peak=Math.max(peak,Math.abs(channel[j]));
        wave[i]=Math.sqrt(peak);
      }
    }
    refresh();draw();
  }
  function analyse(value) {
    const a=value.getChannelData(0),b=value.numberOfChannels>1?value.getChannelData(1):a;
    const count=Math.min(a.length,Math.floor(value.sampleRate*120));
    const samples = new Float32Array(count);
    for(let i=0;i<count;i++)samples[i]=(a[i]+b[i])*.5;
    if(location.protocol==='file:'||typeof Worker==='undefined')return Promise.resolve(estimateKasaneTempo(samples,value.sampleRate));
    return new Promise((resolve,reject)=>{
      const worker=new Worker('editor-tempo.js');
      worker.onmessage=e=>{worker.terminate();if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.result);};
      worker.onerror=()=>{worker.terminate();reject(new Error('BPMを測定できませんでした'));};
      worker.postMessage({samples,sampleRate:value.sampleRate},[samples.buffer]);
    });
  }

  function sections(source) {
    const result=new Map();
    let name=null;
    for(const line of source.split(/\r?\n/)){
      const m=/^\s*\[([^\]]+)\]\s*$/.exec(line);
      if(m){name=m[1];result.set(name,[]);}
      else if(name)result.get(name).push(line);
    }
    return result;
  }
  function readTiming(source) {
    return (sections(source).get('TimingPoints')||[]).flatMap(line=>{
      const cells=line.trim().split(',');
      if(cells.length<2||cells[0]==='')return [];
      const time=Number(cells[0]),value=Number(cells[1]),inherited=cells.length>6?cells[6].trim()!=='1':value<0;
      if(!Number.isFinite(time)||!Number.isFinite(value)||!value||!inherited&&value<0)return [];
      return [{time,value,inherited,meter:Number(cells[2])||4,effects:Number(cells[7])||0,raw:line.trim()}];
    }).sort((a,b)=>a.time-b.time||a.inherited-b.inherited);
  }
  function chartObjects(chart) {
    game.loadNoise(chart);
    const objects=[];
    for(const target of chart.targets){
      const notes=target.type==='single'?[target]:target.notes;
      notes.forEach((o,lane)=>objects.push({type:'note',t:target.t,lane,color:o.color,big:o.big,seal:o.noise||''}));
    }
    for(const o of chart.rolls)objects.push({type:o.type,t:o.t,end:o.end,lane:0,big:!!o.big});
    return objects;
  }
  function fromChart(chart,text,newDifficulty) {
    const d=newDraft();
    d.sourceUid=chart.uid;d.sourceText=text;d.od=chart.od;d.newDifficulty=newDifficulty;
    if(!chart.set.demo)d.key=chart.set.key;
    d.folders=[...(game.effectiveFolders().assignments[chart.set.key]||[])];
    d.meta={title:chart.meta.titleU||chart.meta.title||chart.set.title,artist:chart.meta.artistU||chart.meta.artist||chart.set.artist||'',
      creator:chart.meta.creator,version:chart.meta.version,course:chart.course,
      file:chart.set.demo?'':chart.set.file};
    d.timing=readTiming(text);
    if(!d.timing.some(p=>!p.inherited))d.timing.unshift(...initialTiming());
    if(newDifficulty){
      let version='おに（新規）',suffix=2;
      while(chart.set.charts.some(c=>game.sameVersion(c.meta.version,version)))version=`おに（新規 ${suffix++}）`;
      d.meta.version=version;d.meta.course='oni';
      return d;
    }
    if(chart.sealedRoute)d.sealedRoute={...chart.sealedRoute};
    d.objects=chartObjects(chart).map((o,i)=>({...o,id:i+1}));
    return d;
  }
  function replaceDraft(value,chart=null) {
    pause();audioJob++;coverJob++;coverBusy=false;
    draft=value;original=chart;sourceAudio=null;
    nextId=value.objects.reduce((max,o)=>Math.max(max,o.id),0)+1;
    cursor=0;start=0;timingIndex=0;selection.clear();pending=null;gesture=null;history=[];future=[];
    dirty=false;
    setBuffer(null);syncFields();renderCover();queueRating();selectTool('don');say('');
  }
  function renderCover(){
    if(coverPreviewUrl)URL.revokeObjectURL(coverPreviewUrl);
    coverPreviewUrl=draft.coverFile instanceof Blob?URL.createObjectURL(draft.coverFile):null;
    const url=draft.coverFile===undefined?original?.set.coverUrl:coverPreviewUrl;
    field('CoverPreview').replaceChildren(game.coverElement(url));
    field('CoverRemove').disabled=!url&&!coverBusy;
  }
  async function uploadCover(file){
    if(!file)return;
    const token=++coverJob,url=URL.createObjectURL(file);
    coverBusy=true;
    field('CoverRemove').disabled=false;
    try{
      const image=new Image();
      image.src=url;
      await image.decode();
      const scale=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88));
      if(!blob)throw new Error('ジャケ絵を書き出せませんでした。');
      if(token!==coverJob)return;
      draft.coverFile=blob;
      mark();
      say('ジャケ絵を追加しました。');
    }catch(error){if(token===coverJob)say('この画像をジャケ絵として読み込めませんでした。',true);}
    finally{
      URL.revokeObjectURL(url);
      if(token===coverJob){coverBusy=false;renderCover();}
    }
  }
  function allowReplace() {
    return !dirty||confirm('現在の編集を閉じます。未保存の変更を破棄しますか？');
  }
  async function openChart(chart,newDifficulty=false) {
    if(!chart||!allowReplace())return;
    librarySetKey=chart.set.key;libraryChartUid=chart.uid;
    if(field('Library').open)field('Library').close();
    else field('LibrarySearch').value='';
    const token=++audioJob;
    pause();
    say('譜面を読み込み中…');
    try {
      game.audio();
      const path=chart.sourcePath&&game.nk(chart.sourcePath);
      const content=path&&chart.set.files[path];
      const demo=chart.set.demo?.charts.find(c=>c.version===chart.meta.version);
      const text=content?game.decodeText(await content.async('uint8array')):demo?game.demoOsu(chart.set.demo,demo):'';
      if(token!==audioJob)return;
      if(!text)throw new Error('元の .osu が見つかりません');
      replaceDraft(fromChart(chart,text,newDifficulty),chart);
      await loadDraftAudio();
    }catch(error){if(token===audioJob)say(error.message,true);}
  }
  async function loadDraftAudio() {
    if(!draft.audioFile&&!original)return;
    const token=++audioJob;
    say('音源を読み込み中…');
    try {
      game.audio();
      const sealed=draft.meta.course==='sealed';
      const file=sealed?null:draft.audioFile,chart=sealed?sealedSource():original;
      if(!chart&&!file)throw new Error('移行元の譜面がありません');
      const value=file?await game.decodeAudio(await file.arrayBuffer()):await game.getAudio(chart);
      if(token!==audioJob)return;
      sourceAudio=file||(!chart.set.demo&&game.findFile(chart.set,chart.audio,chart.dir,'audio'))||null;
      setBuffer(value);say('');
    }catch(error){if(token===audioJob)say('音源を開けませんでした。対応する音源を選び直してください。',true);}
  }
  async function upload(file) {
    if(!file||draft.meta.course==='sealed')return;
    const token=++audioJob;
    pause();say('音源を読み込み中…');
    try {
      game.audio();
      const audio=await game.decodeAudio(await file.arrayBuffer());
      if(token!==audioJob)return;
      draft.audioFile=file;sourceAudio=file;setBuffer(audio);mark();say('音源を読み込みました。');
    }catch(error){if(token===audioJob)say('このブラウザで音源を読み込めませんでした。',true);}
  }
  function open() {
    if(field('Library').open)syncLibrary();
    renderFolderOptions();
    if(field('Quote').open)syncQuoteLibrary();
    draw();
  }
  function syncLibrary(force=false) {
    const charts=game.charts();
    const signature=JSON.stringify(charts.map(c=>[
      c.uid,c.set.title,c.set.artist,c.set.file,c.set.aliases,c.meta.creator,c.course,c.level,
      game.text(c.set.title),game.text(c.set.artist),game.text(c.meta.version),game.text(c.meta.creator),
    ]));
    if(!force&&signature===librarySignature)return;
    librarySignature=signature;
    const sets=new Map();
    for(const chart of charts){
      const set=chart.set;
      if(!sets.has(set.key))sets.set(set.key,{set,charts:[]});
      sets.get(set.key).charts.push(chart);
    }
    const order=new Intl.Collator('ja',{numeric:true});
    librarySongs=[...sets.values()].sort((a,b)=>order.compare(a.set.title,b.set.title)||order.compare(a.set.artist,b.set.artist));
    renderLibrarySongs();
  }
  function libraryChoice(name,value,checked,title,detail,onChange,badge) {
    const row=document.createElement('label');
    row.className='ed-library-choice';
    const input=document.createElement('input');
    input.type='radio';input.name=name;input.value=value;input.checked=checked;
    input.addEventListener('change',onChange);
    const text=document.createElement('span');
    const heading=document.createElement('strong');
    heading.textContent=game.text(title);text.append(heading);
    if(detail){
      const sub=document.createElement('small');sub.textContent=game.text(detail);text.append(sub);
    }
    row.append(input,text);
    if(badge)row.append(badge);
    return row;
  }
  function libraryMessage(text) {
    const message=document.createElement('p');message.className='ed-library-empty';message.textContent=text;
    return message;
  }
  function renderLibrarySongs() {
    const terms=game.norm(field('LibrarySearch').value).split(' ').filter(Boolean);
    const results=librarySongs.flatMap(({set,charts})=>{
      const song=[set.title,set.artist,set.titleAscii,set.artistAscii,set.file,...(set.aliases||[])].join(' ');
      const matches=charts.filter(c=>{
        const text=game.norm([song,c.meta.version,c.meta.creator,game.courseInfo[c.course].jp,game.levelText(c)].join(' '));
        return terms.every(term=>text.includes(term));
      });
      return matches.length?[{set,charts:matches}]:[];
    });
    const current=results.find(result=>result.set.key===librarySetKey)||(results.length===1?results[0]:null);
    const list=field('LibrarySongs');
    const focused=list.contains(document.activeElement)?document.activeElement.value:null;
    const scroll=list.scrollTop;
    const rows=results.map(result=>libraryChoice('ed-song',result.set.key,result===current,result.set.title,
      [result.set.artist,`${result.charts.length}譜面`].filter(Boolean).join(' ・ '),()=>showLibraryCharts(result)));
    list.replaceChildren(...(rows.length?rows:[libraryMessage(librarySongs.length?'一致する曲がありません。':'読み込まれた曲はありません。')]));
    if(focused)rows.find(row=>row.firstElementChild.value===focused)?.firstElementChild.focus({preventScroll:true});
    list.scrollTop=scroll;
    field('LibraryCount').textContent=`${results.length}曲`;
    showLibraryCharts(current);
  }
  function showLibraryCharts(result) {
    const list=field('LibraryCharts');
    const focused=list.contains(document.activeElement)?document.activeElement.value:null;
    const scroll=list.dataset.set===result?.set.key?list.scrollTop:0;
    list.dataset.set=result?.set.key||'';
    field('Open').disabled=field('NewDiff').disabled=!result;
    if(!result){list.replaceChildren(libraryMessage('曲を選んでください。'));return;}
    librarySetKey=result.set.key;
    const charts=game.sortCharts(result.charts);
    const selected=charts.find(c=>c.uid===libraryChartUid)||charts[0];
    libraryChartUid=selected.uid;
    list.replaceChildren(...charts.map(c=>{
      const course=game.courseInfo[c.course],badge=document.createElement('span');
      badge.className='ed-library-course';
      badge.style.setProperty('--ed-course',course.color);
      badge.textContent=`${course.jp} ${game.levelText(c)}`;
      return libraryChoice('ed-chart',c.uid,c===selected,c.meta.version,c.meta.creator,()=>{libraryChartUid=c.uid;},badge);
    }));
    if(focused===selected.uid)list.querySelector('input:checked')?.focus({preventScroll:true});
    list.scrollTop=scroll;
  }
  function browseLibrary() {
    const dialog=field('Library'),search=field('LibrarySearch');
    syncLibrary(true);
    dialog.showModal();
    if(!matchMedia('(pointer:coarse)').matches)search.focus();
    const list=field('LibrarySongs'),selected=list.querySelector('input:checked')?.closest('label');
    if(selected){
      const option=selected.getBoundingClientRect(),bounds=list.getBoundingClientRect();
      list.scrollTop+=Math.max(0,option.bottom-bounds.bottom)+Math.min(0,option.top-bounds.top);
    }
  }
  function renderFolderOptions() {
    const box=field('Folders'),data=game.effectiveFolders();
    const selected=new Set(draft.folders||[]);
    const signature=JSON.stringify([data.folders,[...selected]]);
    if(box.dataset.signature===signature)return;
    box.dataset.signature=signature;
    box.replaceChildren(...data.folders.map(f=>{
      const label=document.createElement('label'),check=document.createElement('input');
      check.type='checkbox';check.value=f.id;check.checked=selected.has(f.id);
      check.addEventListener('change',()=>{
        const ids=new Set(draft.folders||[]);
        if(check.checked)ids.add(f.id);else ids.delete(f.id);
        draft.folders=[...ids];mark();
      });
      label.append(check,game.folderTrail(data,f.id));
      return label;
    }));
    if(!data.folders.length)box.textContent='曲選択でフォルダを作成すると、ここで所属先に選べます。';
  }
  function folderMetadata(){
    const data=game.effectiveFolders(),byId=new Map(data.folders.map(f=>[f.id,f]));
    const folders=(draft.folders||[]).filter(id=>byId.has(id)),catalog=new Map();
    for(const id of folders){
      for(let at=id;at&&byId.has(at)&&!catalog.has(at);at=byId.get(at).parent)catalog.set(at,byId.get(at));
    }
    return {folders,folderCatalog:[...catalog.values()]};
  }

  const quoteCanvas=field('QuoteTimeline'),quoteContext=quoteCanvas.getContext('2d');
  function fillChoice(select,items,placeholder=null){
    const previous=select.value;
    select.replaceChildren(...(placeholder?[opt('',placeholder)]:[]),...items.map(([id,label])=>opt(id,label)));
    if(items.some(([id])=>id===previous))select.value=previous;
  }
  function syncQuoteLibrary(){
    const sets=[...new Map(game.charts().map(c=>[c.set.key,c.set])).values()];
    const entries=sets.map(s=>[s.key,s.title]);
    const signature=JSON.stringify(entries);
    if(field('QuoteSet').dataset.signature!==signature){
      field('QuoteSet').dataset.signature=signature;
      fillChoice(field('QuoteSet'),entries,'曲を選択…');
    }
    updateQuoteCharts();
  }
  function updateQuoteCharts(){
    const uid=field('QuoteSet').value;
    const list=game.charts().filter(c=>c.set.key===uid).map(c=>[c.uid,c.meta.version]);
    const select=field('QuoteChart'),signature=JSON.stringify(list);
    if(select.dataset.signature!==signature){select.dataset.signature=signature;fillChoice(select,list);}
    const chart=game.charts().find(c=>c.uid===select.value);
    if(chart!==quoted?.chart){
      quoted=chart?{chart,objects:chartObjects(chart),end:Math.max(1,chart.length)}:null;
      setQuoteRange(0,quoted?.end||0);
    }
    field('QuoteInsert').disabled=!quoted;
    field('QuoteAll').disabled=!quoted;
    drawQuote();
  }
  const quoteRange=()=>[Number(field('QuoteFrom').value)*1000,Number(field('QuoteTo').value)*1000];
  function setQuoteRange(from,to){
    field('QuoteFrom').value=(from/1000).toFixed(3);field('QuoteTo').value=(to/1000).toFixed(3);
    drawQuote();
  }
  function drawQuote(){
    const w=quoteCanvas.clientWidth,h=quoteCanvas.clientHeight;
    if(!w||!h)return;
    const scale=Math.min(2,window.devicePixelRatio||1);
    if(quoteCanvas.width!==Math.round(w*scale)||quoteCanvas.height!==Math.round(h*scale)){
      quoteCanvas.width=Math.round(w*scale);quoteCanvas.height=Math.round(h*scale);
    }
    const c=quoteContext;c.setTransform(scale,0,0,scale,0,0);
    c.fillStyle='#261d35';c.fillRect(0,0,w,h);
    if(!quoted)return;
    const xAt=t=>t/quoted.end*w,[from,to]=quoteRange();
    c.fillStyle='#714b784f';c.fillRect(xAt(from),0,xAt(to-from),h);
    for(const o of quoted.objects){
      c.fillStyle=o.type==='note'?o.color==='d'?'#fc7264':'#50cbee':'#f5b84b';
      c.fillRect(xAt(o.t),8+o.lane*12,Math.max(1,xAt((o.end??o.t)-o.t)),8);
    }
    c.fillStyle='#fff1cf';
    for(const at of [from,to])c.fillRect(Math.min(w-2,xAt(at)),0,2,h);
  }
  function quotePosition(event){
    const box=quoteCanvas.getBoundingClientRect();
    return Math.round(Math.max(0,Math.min(1,(event.clientX-box.left)/box.width))*quoted.end);
  }
  function beatClock(points){
    const rate=[...points].sort((a,b)=>a.time-b.time);
    let unit=0;
    const markers=rate.map((point,i)=>{
      if(i)unit+=(point.time-rate[i-1].time)/rate[i-1].value;
      return {...point,unit};
    });
    const lastAt=(value,key)=>{
      for(let i=markers.length-1;i>0;i--)if(markers[i][key]<=value)return markers[i];
      return markers[0];
    };
    return {
      beat(t){const p=lastAt(t,'time');return p.unit+(t-p.time)/p.value;},
      time(b){const p=lastAt(b,'unit');return p.time+(b-p.unit)*p.value;},
    };
  }
  function insertQuote(){
    if(!quoted)return;
    const [from,to]=quoteRange();
    if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||from>=to||to>quoted.end+.001){
      say('引用元の開始・終了を曲の範囲内で指定してください。',true);return;
    }
    const sourcePoints=[...new Map(quoted.chart.segs.map(s=>[s.rt,{time:s.rt,value:s.bl}])).values()];
    const sourceClock=beatClock(sourcePoints),destination=beatClock(reds());
    const first=sourceClock.beat(from),at=destination.beat(snap(cursor)),converted=t=>Math.round(destination.time(at+sourceClock.beat(t)-first));
    const incoming=quoted.objects.flatMap(o=>{
      if(o.type==='note')return o.t>=from&&o.t<=to?[{...o,id:nextId++,t:converted(o.t)}]:[];
      if(o.t>=to||o.end<=from)return [];
      const t=converted(Math.max(from,o.t)),end=converted(Math.min(to,o.end));
      return [{...o,id:nextId++,t,end:Math.max(end,t+(o.type==='balloon'?100:40))}];
    });
    if(!incoming.length){say('指定した範囲にノーツがありません。',true);return;}
    if(commit([...draft.objects,...incoming])){
      selection=new Set(incoming.map(o=>o.id));refreshSelection();draw();
      say(`${quoted.chart.set.title} / ${quoted.chart.meta.version} から ${incoming.length}個を引用しました。`);
    }
  }

  const keyOf=line=>line.slice(0,line.indexOf(':')).trim();
  function updateFields(base,changes) {
    return [...base.filter(line=>line.trim()&&!Object.hasOwn(changes,keyOf(line))),
      ...Object.entries(changes).map(([k,v])=>`${k}: ${v}`)];
  }
  function osuText(audioName) {
    const parts=sections(draft.sourceText),m=draft.meta;
    const difficulty=parts.get('Difficulty')||[];
    const sliderLine=difficulty.find(line=>keyOf(line)==='SliderMultiplier');
    const sliderMultiplier=Number(sliderLine?.split(':')[1])||1.4;
    const timing=draft.timing.map(p=>p.raw||[p.time,p.value.toFixed(10),p.meter,1,0,100,p.inherited?0:1,p.effects].join(','));
    const circles=sorted().map(o=>{
      const y=64+o.lane*64,hs=(o.color==='k'?8:0)+(o.big?4:0);
      if(o.type==='note')return `256,${y},${o.t},1,${hs},0:0:0:0:`;
      if(o.type==='balloon')return `256,${y},${o.t},8,0,${Math.round(o.end)},0:0:0:0:`;
      let beat=reds()[0].value,sv=1;
      for(const p of draft.timing){
        if(p.time>o.t)break;
        if(p.inherited)sv=Math.min(10,Math.max(.1,-100/p.value));
        else {beat=p.value;sv=1;}
      }
      const distance=(o.end-o.t)/beat*(sliderMultiplier*100*sv);
      return `128,${y},${o.t},2,${hs},L|400:${y},1,${distance.toFixed(8)}`;
    });
    const output={
      General:updateFields(parts.get('General')||[],{AudioFilename:audioName,Mode:1}),
      Editor:updateFields(parts.get('Editor')||[],{BeatDivisor:draft.snap||4}),
      Metadata:updateFields(parts.get('Metadata')||[],{
        Title:clean(m.title),TitleUnicode:clean(m.title),Artist:clean(m.artist),ArtistUnicode:clean(m.artist),
        Creator:clean(m.creator),Version:clean(m.version)||game.courseInfo[m.course].jp,BeatmapID:0,BeatmapSetID:-1,
      }),
      Difficulty:updateFields(difficulty,{OverallDifficulty:draft.od,SliderMultiplier:sliderMultiplier}),
      Events:original?(parts.get('Events')||[]):[],
      TimingPoints:timing,HitObjects:circles,
    };
    return ['osu file format v14',...Object.entries(output).flatMap(([name,lines])=>['',`[${name}]`,...lines]),''].join('\n');
  }
  function build(audioName,preview=false) {
    if(!draft.objects.length)throw new Error('ノーツを配置してください。');
    const error=validate(draft.objects);
    if(error)throw new Error(error);
    if(!preview&&!clean(draft.meta.title))throw new Error('曲名を入力してください。');
    const text=osuText(audioName),chart=game.parseOsu(text);
    const stacks=groups(sorted()),noise={};
    chart.targets.forEach((t,i)=>{
      const notes=stacks.get(t.t)||[];
      if(game.noiseEligible(t)&&notes.some(o=>o.seal))noise[game.noiseId(t,i)]=notes.map(o=>o.seal||null);
    });
    chart.archiveNoise=noise;
    chart.course=draft.meta.course==='sealed'?'sealed':chart.stats.chords?'kasane':draft.meta.course;
    if(chart.course==='sealed'&&!preview){
      const route=SealedRoute.parse(draft.sealedRoute),source=sealedSource();
      if(!source)throw new Error('同じ曲の通常譜面を移行元に指定してください。');
      if(!route)throw new Error('封印の移行位置・キャラクターLv・可と不可の上限を確認してください。');
      if(!SealedRoute.validSplit(route,source,chart)){
        throw new Error('移行元には切り替え前に、封印譜面には切り替え後にノーツを配置してください。移行位置は移行元の演奏区間内に設定してください。');
      }
      chart.sealedRoute=route;
    }
    const rating=game.rateChart(chart);
    chart.level=rating.level;
    return {text,chart,noise,rating,course:chart.course,level:rating.level};
  }
  function queueRating() {
    cancelAnimationFrame(ratingFrame);
    ratingFrame=requestAnimationFrame(()=>{
      const level=field('Level'),breakdown=field('RatingBreakdown');
      level.value='—';level.removeAttribute('title');breakdown.replaceChildren();
      if(!draft.objects.length)return;
      try{
        const {chart,rating}=build('editor-audio.wav',true);
        level.value=game.levelText(chart);
        if(chart.course!=='kasane')level.title=`内部定数 ${rating.level.toFixed(1)}`;
        breakdown.replaceChildren(...ratingParts.map(([key,label])=>{
          const part=document.createElement('div');
          const name=document.createElement('dt'),value=document.createElement('dd');
          name.textContent=label;value.textContent=rating[key].toFixed(2);
          part.append(name,value);return part;
        }));
      }catch(error){level.value='推定できません';level.title=error.message;}
    });
  }
  function toWav(audio) {
    const channels=Math.min(2,audio.numberOfChannels), frames=audio.length;
    const data=new ArrayBuffer(44+frames*channels*2),view=new DataView(data);
    const ascii=(at,s)=>[...s].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
    const u16=(at,v)=>view.setUint16(at,v,true),u32=(at,v)=>view.setUint32(at,v,true);
    ascii(0,'RIFF');u32(4,data.byteLength-8);ascii(8,'WAVE');ascii(12,'fmt ');u32(16,16);
    u16(20,1);u16(22,channels);u32(24,audio.sampleRate);u32(28,audio.sampleRate*channels*2);
    u16(32,channels*2);u16(34,16);ascii(36,'data');u32(40,data.byteLength-44);
    const inputs=Array.from({length:channels},(_,i)=>audio.getChannelData(i));
    for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++){
      const sample=Math.max(-1,Math.min(1,inputs[ch][i]));
      view.setInt16(44+(i*channels+ch)*2,Math.round(sample*(sample<0?32768:32767)),true);
    }
    return data;
  }
  async function pack() {
    if(!buffer)throw new Error('音源を選んでください。');
    if(coverBusy)throw new Error('ジャケ絵の読み込みが終わってから書き出してください。');
    if(typeof JSZip==='undefined')throw new Error('ZIPライブラリを読み込めませんでした。');
    const src=sourceAudio,sourceChart=original?.set.demo?null:original,audio=buffer,name=fileName();
    const suffix=/\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.exec(src?.name||'')?.[1]||'wav';
    const zip=new JSZip();
    const dir=sourceChart?.sourcePath?.replace(/\\/g,'/').split('/').slice(0,-1).join('/')||'';
    const archivePath=file=>dir?dir+'/'+file:file;
    const siblings=sourceChart?.set.charts.filter(c=>draft.newDifficulty||c!==sourceChart)||[];
    const uniquePath=(base,ext)=>{
      let file=base+ext,n=2;
      while(sourceChart?.set.files[game.nk(archivePath(file))])file=base+'-'+(n++)+ext;
      return file;
    };
    const routeAudio=draft.meta.course==='sealed'&&src?.name;
    const audioName=routeAudio||uniquePath('editor-audio','.'+suffix.toLowerCase());
    const content=build(audioName);
    if(siblings.some(c=>game.sameVersion(c.meta.version,content.chart.meta.version))){
      throw new Error('同じ難易度名がすでにあります。別の名前にしてください。');
    }
    const replacing=sourceChart&&!draft.newDifficulty;
    const chartPath=replacing?sourceChart.sourcePath:archivePath(uniquePath('editor-chart','.osu'));
    for(const sibling of siblings){
      const route=sibling.sealedRoute;
      if(replacing&&route&&game.nk(route.sourcePath)===game.nk(chartPath)&&!SealedRoute.validSplit(route,content.chart,sibling)){
        throw new Error(`封印譜面「${sibling.meta.version}」の移行条件を満たす通常譜面を残してください。`);
      }
    }
    const set=sourceChart?.set,song={key:draft.key,title:content.chart.meta.titleU,artist:content.chart.meta.artistU,
      aliases:set?[...new Set([...(set.aliases||[]),set.title,set.file])]:[],...folderMetadata()};
    const cover=draft.coverFile;
    song.cover=cover===undefined?set?.coverFile?.name??null:null;
    if(cover instanceof Blob){
      song.cover=archivePath(uniquePath('editor-cover',cover.type==='image/webp'?'.webp':'.png'));
      zip.file(song.cover,await cover.arrayBuffer());
    }
    if(sourceChart){
      for(const asset of Object.values(sourceChart.set.files)){
        const path=game.nk(asset.name);
        if(path==='kasane.json'||(replacing&&path===game.nk(chartPath))||
          (asset===src&&!siblings.length))continue;
        zip.file(asset.name,await asset.async('uint8array'));
      }
    }
    if(!routeAudio){
      const bytes=src instanceof Blob?await src.arrayBuffer():src?await src.async('uint8array'):toWav(audio);
      zip.file(archivePath(audioName),bytes);
    }
    zip.file(chartPath,content.text);
    const charts=siblings.map(c=>({path:c.sourcePath,version:c.meta.version,course:c.course,level:c.level,noise:game.noiseData(c),sealedRoute:c.sealedRoute}));
    const entry={path:chartPath,version:content.chart.meta.version,course:content.course,level:content.level,noise:content.noise,sealedRoute:content.chart.sealedRoute};
    if(replacing)charts.splice(sourceChart.set.charts.indexOf(sourceChart),0,entry);
    else charts.push(entry);
    zip.file('kasane.json',JSON.stringify({format:1,song,charts}));
    return {name:name+'.ktz',blob:await zip.generateAsync({type:'blob',compression:'STORE'})};
  }
  function download(name,blob) {
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.download=name;a.href=url;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function safeAction(action) {
    return async event=>{
      try{await action(event);}
      catch(error){say(error.message,true);}
    };
  }

  for(const [id,key] of Object.entries(metadata)){
    if(id==='Course')continue;
    field(id).addEventListener('input',()=>{draft.meta[key]=field(id).value;mark();});
  }
  field('Course').onchange=()=>{
    const course=field('Course').value,wasSealed=draft.meta.course==='sealed';
    if(course==='sealed'&&!sealedSources().length){
      refresh();say('封印譜面は「同じ曲に新規譜面」から作成し、移行元の通常譜面を残してください。',true);return;
    }
    draft.meta.course=course;
    if(course==='sealed'&&!sealedSource()){
      const source=sealedSources()[0];
      draft.sealedRoute={sourcePath:source.sourcePath,at:null,character:null,minLevel:1,maxBad:0,maxOk:0};
    }
    syncSealed();mark();
    if(wasSealed!==(course==='sealed')){pause();setBuffer(null);loadDraftAudio();}
  };
  field('SealedSource').onchange=()=>{
    draft.sealedRoute.sourcePath=field('SealedSource').value;
    pause();setBuffer(null);mark();loadDraftAudio();
  };
  field('SealedCharacter').onchange=()=>{
    draft.sealedRoute.character=field('SealedCharacter').value||null;
    if(!draft.sealedRoute.character){draft.sealedRoute.minLevel=1;field('SealedMinLevel').value=1;}
    mark();
  };
  for(const [id,key] of Object.entries(sealedNumbers)){
    const input=field('Sealed'+id);
    input.oninput=()=>{draft.sealedRoute[key]=Number.isNaN(input.valueAsNumber)?null:input.valueAsNumber;mark();};
  }
  field('SealedHere').onclick=()=>{
    draft.sealedRoute.at=Math.round(cursor);field('SealedAt').value=draft.sealedRoute.at;mark();
  };
  field('New').onclick=()=>{if(allowReplace())replaceDraft(newDraft());};
  field('Browse').onclick=browseLibrary;
  field('LibraryClose').onclick=()=>field('Library').close();
  field('Library').addEventListener('keydown',event=>{
    if(event.key!=='Escape'||event.isComposing)return;
    event.preventDefault();field('Library').close();
  });
  field('LibrarySearch').oninput=()=>{field('LibrarySongs').scrollTop=0;renderLibrarySongs();};
  field('LibrarySearch').addEventListener('keydown',event=>{
    if(event.isComposing||!['ArrowDown','Enter'].includes(event.key))return;
    const list=field('LibrarySongs');
    const first=list.querySelector('input:checked')||list.querySelector('input');
    if(first){event.preventDefault();first.focus();}
  });
  field('LibrarySongs').addEventListener('keydown',event=>{
    if(event.key!=='Enter'||!event.target.matches('input'))return;
    event.preventDefault();
    if(!event.target.checked)event.target.click();
    field('LibraryCharts').querySelector('input:checked')?.focus();
  });
  field('LibraryCharts').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target.matches('input')){
      event.preventDefault();field('Open').click();
    }
  });
  field('Open').onclick=()=>openChart(game.charts().find(c=>c.uid===libraryChartUid));
  field('NewDiff').onclick=()=>openChart(game.charts().find(c=>c.uid===libraryChartUid),true);
  field('Quote').addEventListener('toggle',()=>{if(field('Quote').open)syncQuoteLibrary();});
  field('QuoteSet').onchange=updateQuoteCharts;
  field('QuoteChart').onchange=updateQuoteCharts;
  field('QuoteFrom').oninput=drawQuote;field('QuoteTo').oninput=drawQuote;
  field('QuoteAll').onclick=()=>{if(quoted)setQuoteRange(0,quoted.end);};
  field('QuoteInsert').onclick=safeAction(insertQuote);
  quoteCanvas.addEventListener('pointerdown',event=>{
    if(!quoted||event.button!==0)return;
    quoteDrag={id:event.pointerId,start:quotePosition(event)};
    quoteCanvas.setPointerCapture(event.pointerId);
    setQuoteRange(quoteDrag.start,quoteDrag.start);
  });
  quoteCanvas.addEventListener('pointermove',event=>{
    if(event.pointerId!==quoteDrag?.id)return;
    const t=quotePosition(event);setQuoteRange(Math.min(t,quoteDrag.start),Math.max(t,quoteDrag.start));
  });
  quoteCanvas.addEventListener('pointerup',event=>{
    if(event.pointerId!==quoteDrag?.id)return;
    const t=quotePosition(event),from=quoteDrag.start;
    quoteDrag=null;setQuoteRange(Math.min(t,from),t===from?Math.min(quoted.end,t+4000):Math.max(t,from));
  });
  quoteCanvas.addEventListener('pointercancel',()=>{quoteDrag=null;});
  field('Audio').onchange=e=>{upload(e.target.files[0]);e.target.value='';};
  field('Cover').onchange=e=>{uploadCover(e.target.files[0]);e.target.value='';};
  field('CoverRemove').onclick=()=>{
    coverJob++;coverBusy=false;draft.coverFile=null;renderCover();mark();
    say('ジャケ絵を外しました。');
  };
  pane.addEventListener('drop',e=>{
    const file=[...(e.dataTransfer?.files||[])].find(f=>f.type.startsWith('audio/')||/\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(f.name));
    if(!file)return;
    e.preventDefault();e.stopPropagation();upload(file);
  });
  field('Play').onclick=()=>playing?pause():play();
  field('Home').onclick=()=>seek(0,true);
  field('Snap').onchange=()=>{draft.snap=Number(field('Snap').value);mark();};
  field('Zoom').onchange=()=>{span=Number(field('Zoom').value);moveView(cursor,true);draw();};
  field('Seek').oninput=()=>seek(Number(field('Seek').value),true);
  field('Undo').onclick=()=>restoreHistory(history,future);
  field('Redo').onclick=()=>restoreHistory(future,history);
  field('Delete').onclick=()=>remove(selection);
  field('TimingList').onchange=()=>{timingIndex=field('TimingList').selectedIndex;syncTiming();};
  field('TimingApply').onclick=()=>changeTiming(false);
  field('TimingAdd').onclick=()=>changeTiming(true);
  field('TimingRemove').onclick=()=>{
    const point=reds()[timingIndex];
    if(reds().length<=1)return;
    checkpoint();draft.timing=draft.timing.filter(p=>p!==point);syncTiming();mark();
  };
  field('Measure').onclick=safeAction(async()=>{
    const audio=buffer,button=field('Measure');
    if(!audio)return;
    button.disabled=true;estimate=null;field('ApplyTempo').hidden=true;
    field('TempoResult').textContent='音源の拍を測定中…';
    try{
      const result=await analyse(audio);
      if(buffer!==audio)return;
      estimate=result;
      field('ApplyTempo').hidden=!result;
      field('TempoResult').textContent=result?
        `推定 ${result.bpm} BPM ・ 拍位置 ${result.offset} ms${result.confidence<.4?'（要確認）':''}。再生してグリッドと聴き比べてください。`:
        '拍を特定できませんでした。BPMと開始位置を手入力してください。';
    }catch(error){
      if(buffer===audio)field('TempoResult').textContent=error.message;
    }finally{button.disabled=!buffer;}
  });
  field('ApplyTempo').onclick=()=>{
    if(!estimate)return;
    const points=reds(),first=points[0];
    if(points.slice(1).some(p=>p.time<=estimate.offset)){
      say('次のタイミング点より後になるため、BPMと開始位置を手入力してください。',true);return;
    }
    checkpoint();Object.assign(first,{time:estimate.offset,value:60000/estimate.bpm,raw:null});
    draft.timing.sort((a,b)=>a.time-b.time||a.inherited-b.inherited);
    timingIndex=0;syncTiming();mark();
  };
  field('Save').onclick=safeAction(async()=>{
    const saving=draft,cover=draft.coverFile,state=JSON.stringify({...saving,audioFile:null,coverFile:null});
    const key=await game.saveDraft({format:1,draft:{...saving}});
    if(!key)throw new Error('下書きを保存できませんでした。');
    if(draft===saving&&cover===draft.coverFile&&state===JSON.stringify({...draft,audioFile:null,coverFile:null})){dirty=false;refresh();}
    say('このブラウザに下書きを保存しました。');
  });
  field('Restore').onclick=safeAction(async()=>{
    if(!allowReplace())return;
    const record=await game.readDraft();
    if(record?.format!==1){say('保存した下書きがありません。',true);return;}
    const chart=game.charts().find(c=>c.uid===record.draft.sourceUid);
    replaceDraft(record.draft,chart);
    await loadDraftAudio();
    if(!buffer&&record.draft.sourceUid&&!chart)say('元の譜面が見つかりません。音源を選び直してください。',true);
  });
  field('Export').onclick=safeAction(async()=>{
    const button=field('Export'), exporting=draft, audio=draft.audioFile,cover=draft.coverFile;
    const state=JSON.stringify({...draft,audioFile:null,coverFile:null});
    button.disabled=true;say('書き出し中…');
    try{
      const result=await pack();
      download(result.name,result.blob);
      if(draft===exporting){
        if(audio===draft.audioFile&&cover===draft.coverFile&&state===JSON.stringify({...draft,audioFile:null,coverFile:null}))dirty=false;
        say(`${result.name} を書き出しました。`);
      }
    }finally{refresh();}
  });
  field('Test').onclick=safeAction(async()=>{
    if(!buffer)return;
    const {chart}=build('editor-audio.wav');
    const {meta}=draft;
    chart.uid='editor-preview::'+chart.meta.version;
    chart.set={key:'editor-preview',title:clean(meta.title),artist:clean(meta.artist),editorAudio:buffer,charts:[chart]};
    pause();await game.test(chart);
  });
  field('SaveSeal').onclick=safeAction(()=>{
    if(!original)return;
    const {chart}=build('editor-audio.wav');
    const signature=c=>c.targets.map((t,i)=>game.noiseId(t,i)).join('\n');
    if(signature(original)!==signature(chart))throw new Error('ノーツの配置が変わっています。編集済みの譜面を .ktz で書き出してください。');
    game.loadNoise(chart);
    original.targets.forEach((t,i)=>{
      const a=t.type==='single'?[t]:t.notes;
      const b=chart.targets[i].type==='single'?[chart.targets[i]]:chart.targets[i].notes;
      a.forEach((n,j)=>{n.noise=b[j].noise;});
    });
    if(game.saveNoise(original))say('元の譜面の封印をこのブラウザに保存しました。');
  });
  function copySelection(cut) {
    const notes=sorted().filter(o=>selection.has(o.id));
    if(!notes.length)return;
    const origin=notes[0].t;
    clipboard=notes.map(o=>({...o,t:o.t-origin,end:o.end==null?undefined:o.end-origin}));
    if(cut)remove(selection);
  }
  function pasteSelection() {
    if(!clipboard.length)return;
    const at=snap(cursor);
    const placed=clipboard.map(o=>({...o,id:nextId++,t:o.t+at,end:o.end==null?undefined:o.end+at}));
    if(commit([...draft.objects,...placed])){selection=new Set(placed.map(o=>o.id));refreshSelection();draw();}
  }
  document.addEventListener('keydown',event=>{
    if(pane.hidden||field('Library').open||!document.querySelector('#stage')?.hidden||!document.querySelector('#title')?.hidden||
      event.target?.closest?.('input,select,textarea,[contenteditable=true]'))return;
    const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
    let action=null;
    if(mod){
      if(key==='z')action=event.shiftKey?field('Redo').onclick:field('Undo').onclick;
      if(key==='y')action=field('Redo').onclick;
      if(key==='a')action=()=>{selection=new Set(draft.objects.map(o=>o.id));refreshSelection();draw();};
      if(key==='c'||key==='x')action=()=>copySelection(key==='x');
      if(key==='v')action=pasteSelection;
    }else if(key===' ')action=field('Play').onclick;
    else if(key==='arrowleft'||key==='arrowright')action=()=>stepCursor(key==='arrowleft'?-1:1,event.shiftKey);
    else if(key==='delete'||key==='backspace')action=()=>remove(selection);
    else if(key==='escape')action=()=>{pending=null;selection.clear();refreshSelection();draw();};
    else {
      const digit=/^Digit([0-9])$/.exec(event.code)?.[1];
      if(!event.shiftKey&&digit!=null){
        const match=tools.find(tool=>tool[2]===digit);
        if(match)action=()=>selectTool(match[0]);
      }else if(event.shiftKey&&digit!=null){
        action=()=>{draft.snap=Number(digit);field('Snap').value=draft.snap;mark();};
      }
    }
    if(action){event.preventDefault();if(!event.repeat||key.startsWith('arrow'))action(event);}
  });
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(draw).observe(canvas);
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(drawQuote).observe(quoteCanvas);
  window.addEventListener('resize',draw);
  syncFields();renderCover();selectTool(tool);
  return {open,pause,openChart};
}
