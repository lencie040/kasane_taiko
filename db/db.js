'use strict';

const $=selector=>document.querySelector(selector);
const controls={query:$('#query'),course:$('#course'),folder:$('#folder'),order:$('#order')};
const results=$('#results'),status=$('#status');
const radarLabels=['物量','技術','リズム','視認難','ギミック'];
const courses={easy:'かんたん',normal:'ふつう',hard:'むずかしい',oni:'おに',ura:'おに裏',kasane:'重',sealed:'封印'};
const roman=['','I','II','III','IV','V','VI','VII','VIII','IX','X'];
const abilities={gauge_up:'クリア前のゲージ増加 2倍・減少 1/2',good_wide:'良判定が少し優しい',
  score_up:'スコア増加 1.1倍',renda_up:'連打のスコア 5倍',gauge_down:'ゲージ増加 1/2・減少 2倍',
  good_tight:'良判定が少し厳しい',seal:'通常ノーツが稀に封印ノーツになる'};
const format=new Intl.NumberFormat('ja-JP'),collator=new Intl.Collator('ja',{numeric:true});
const fold=value=>String(value??'').normalize('NFKC').toLowerCase().trim();
const fmt=value=>format.format(value);
const time=(ms,precise=false)=>{
  const seconds=Math.max(0,ms/1000),minutes=Math.floor(seconds/60);
  const remainder=precise?(seconds%60).toFixed(3).padStart(6,'0'):String(Math.floor(seconds%60)).padStart(2,'0');
  return minutes+':'+remainder;
};
const bpm=([lo,hi])=>lo===hi?fmt(lo):fmt(lo)+'–'+fmt(hi);
const constant=chart=>chart.course==='kasane'?roman[chart.level]:'★'+chart.level.toFixed(1);
const chartHash=uid=>'#chart='+encodeURIComponent(uid);
const node=(tag,classes,...children)=>{
  const element=document.createElement(tag);
  if(classes)element.className=classes;
  element.append(...children);
  return element;
};
const pair=(label,value)=>node('div','',node('dt','',label),node('dd','',value));
const fieldLink=(label,href)=>{
  const anchor=node('a','',label);anchor.href=href;return anchor;
};

let data,rows=[],byUid,folders,characters,view='charts';

function folderTrail(id){
  const visited=new Set(),names=[];
  for(let row=folders.get(id);row&&!visited.has(row.id);row=folders.get(row.parent)){
    visited.add(row.id);names.unshift(row.name);
  }
  return names.join(' / ');
}

function chartStats(chart){
  const stats=[
    ['内部定数',constant(chart)],['BPM',bpm(chart.bpm)],['譜面長',time(chart.length)],
    ['ノーツ',fmt(chart.notes)],['ドン',fmt(chart.don)],['カッ',fmt(chart.ka)],
    ['大音符',fmt(chart.big)],['同時押し',fmt(chart.chords)+'箇所'],['封印ノーツ',fmt(chart.sealedNotes)],
    ['連打',fmt(chart.rolls)],['風船',fmt(chart.balloons)],['最大レーン',fmt(chart.maxLanes)]
  ];
  if(chart.estimatedLevel!==undefined){
    stats.splice(1,0,['設定方法','手動'],['推定レベル',constant({...chart,level:chart.estimatedLevel})]);
  }
  return node('section','',node('h3','','譜面情報'),node('dl','stats',...stats.map(([label,value])=>pair(label,value))));
}

function chartTraits(chart){
  const list=node('dl','traits');
  radarLabels.forEach((label,i)=>{
    const score=chart.radar[i],bar=node('span','');
    bar.style.width=(score/1.5)+'%';
    const track=node('div','trait-track',bar);track.setAttribute('aria-hidden','true');
    list.append(node('div','',node('dt','',label),track,node('dd','',String(score))));
  });
  return node('section','',node('h3','','譜面レーダー（0〜150）'),list);
}

function sealedRoute(route){
  const source=fieldLink(route.sourceVersion+'（'+courses[route.sourceCourse]+'）',chartHash(route.sourceUid));
  const character=route.character===null?'なし':(characters.get(route.character)?.name||route.character)+' Lv '+route.minLevel+'以上';
  const {potential,life,ok,bad}=data.sealed;
  const list=node('dl','stats',pair('移行元',source),pair('移行位置',time(route.at,true)),pair('ポテンシャル',potential.toFixed(2)+'以上'),
    pair('キャラクター',character),pair('移行前の可',fmt(route.maxOk)+'以下'),pair('移行前の不可',fmt(route.maxBad)+'以下'),
    pair('移行前の最大コンボ',route.minCombo?fmt(route.minCombo)+'以上':'条件なし'));
  return node('section','route',node('h3','','封印の解禁条件'),list,
    node('p','',`移行後はライフ ${life} で開始。可で −${ok}、不可で −${bad}。ライフを残して最後まで演奏すると解禁。`));
}

function populate(details,song,chart){
  if(details.querySelector('.chart-body'))return;
  const body=node('div','chart-body',chartStats(chart),chartTraits(chart));
  if(chart.route)body.append(sealedRoute(chart.route));
  const membership=song.folders.map(folderTrail).filter(Boolean);
  body.append(node('footer','chart-footer',
    node('span','','譜面作者 '+(chart.creator||'—')),
    node('span','','所属 '+(membership.join(' ／ ')||'未設定')),
    fieldLink('この譜面へのリンク',chartHash(chart.uid))));
  details.append(body);
}

function chartRow({song,chart}){
  const cover=node('span','cover','♪');cover.setAttribute('aria-hidden','true');
  if(song.cover){
    const image=node('img','');image.src=song.cover;image.alt='';image.loading='lazy';image.decoding='async';
    image.addEventListener('error',()=>image.remove(),{once:true});cover.append(image);
  }
  const toggle=node('span','toggle');toggle.setAttribute('aria-hidden','true');
  const details=node('details','chart'+(chart.route?' sealed':''));
  details.id=chartHash(chart.uid).slice(1);
  details.append(node('summary','',
    node('div','song',cover,node('div','song-name',song.title,node('small','song-meta',song.artist||'—'))),
    node('div','course-name',courses[chart.course],...(chart.version===courses[chart.course]?[]:[node('small','',chart.version)])),
    node('span','value level',constant(chart)),
    node('span','value summary-bpm',bpm(chart.bpm),node('small','summary-unit','BPM')),
    node('span','value summary-notes',fmt(chart.notes),node('small','summary-unit','ノーツ')),
    toggle));
  details.addEventListener('toggle',()=>{if(details.open)populate(details,song,chart);});
  return details;
}

function characterUnlock(character){
  if(character.unlock_text)return character.unlock_text;
  const target=character.unlock_target||'';
  const name='「'+target+'」'+(character.unlock_course?'（'+(courses[character.unlock_course]||character.unlock_course)+'）':'');
  const amount=fmt(Number(character.unlock_value)||0);
  return ({dan_pass:target+'に合格',dan_gold:target+'に金合格',song_clear:name+'をクリア',
    song_full:name+'をフルコンボ',song_zen:name+'を全良',song_score:name+'で'+amount+'点以上',
    song_renda:name+'で連打'+amount+'打以上'})[character.unlock_type]||'—';
}

function characterCard(character){
  const card=node('article','character');
  if(character.image){
    const image=node('img','');image.alt='';image.loading='lazy';
    image.src='../content/characters/'+encodeURIComponent(character.image);
    image.addEventListener('error',()=>image.remove(),{once:true});
    card.append(image);
  }
  card.append(node('div','',node('h2','',character.name||character.id),
    node('dl','',pair('能力',abilities[character.ability]||character.ability||'—'),
      pair('入手条件',characterUnlock(character)))));
  return card;
}

function chartOrder(a,b){
  const byTitle=()=>collator.compare(a.song.title,b.song.title)||collator.compare(a.chart.version,b.chart.version);
  switch(controls.order.value){
    case 'level-desc':
    case 'level-asc': {
      const type=Number(a.chart.course==='kasane')-Number(b.chart.course==='kasane');
      const direction=controls.order.value==='level-asc'?1:-1;
      return type||direction*(a.chart.level-b.chart.level)||byTitle();
    }
    case 'notes':return b.chart.notes-a.chart.notes||byTitle();
    case 'bpm':return b.chart.bpm[1]-a.chart.bpm[1]||byTitle();
    default:return byTitle();
  }
}

function render(){
  if(!data)return;
  const characterView=view==='characters';
  $('#filters').hidden=characterView;
  controls.course.closest('label').hidden=view==='sealed';
  $('#order-note').hidden=characterView||!controls.order.value.startsWith('level-');
  for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===view));
  if(characterView){
    results.replaceChildren(node('div','character-list',...Array.from(characters.values(),characterCard)));
    status.textContent=characters.size?fmt(characters.size)+'人':'公開キャラクターはありません。';
    return;
  }
  const words=fold(controls.query.value).split(/\s+/).filter(Boolean);
  const folder=controls.folder.value,course=view==='sealed'?'sealed':controls.course.value;
  const found=rows.filter(({song,chart,search})=>
    (!course||chart.course===course)&&
    (!folder||(folder==='@unassigned'?!song.folders.some(id=>folders.has(id)):song.folders.includes(folder)))&&
    words.every(word=>search.includes(word))).sort(chartOrder);
  status.textContent=found.length?fmt(found.length)+'譜面 ・ '+fmt(new Set(found.map(row=>row.song.key)).size)+'曲':
    '条件に一致する譜面がありません。';
  results.replaceChildren(...found.map(chartRow));
}

function openHash(){
  const hash=location.hash.slice(1);
  if(!hash.startsWith('chart='))return;
  let uid;
  try{uid=decodeURIComponent(hash.slice(6));}catch{return;}
  if(!byUid?.has(uid))return;
  let entry=document.getElementById(chartHash(uid).slice(1));
  if(!entry){
    view='charts';
    for(const key of ['query','course','folder'])controls[key].value='';
    render();
    entry=document.getElementById(chartHash(uid).slice(1));
  }
  const {song,chart}=byUid.get(uid);
  populate(entry,song,chart);entry.open=true;
  entry.scrollIntoView({block:'start'});entry.querySelector('summary').focus({preventScroll:true});
}

for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
  view=button.dataset.view;
  if(location.hash)history.replaceState(null,'',location.pathname+location.search);
  render();
});
for(const input of Object.values(controls))input.addEventListener(input.type==='search'?'input':'change',render);
window.addEventListener('hashchange',openHash);
results.addEventListener('click',event=>{
  if(event.target.closest('a')?.hash===location.hash&&location.hash)openHash();
});

async function start(){
  const response=await fetch('catalog.json');
  if(!response.ok)throw new Error('HTTP '+response.status);
  data=await response.json();
  if(data.format!==1)throw new Error('Unknown catalog format');
  folders=new Map(data.folders.map(f=>[f.id,f]));
  characters=new Map(data.characters.filter(c=>abilities[c.ability]).map(c=>[c.id,c]));
  rows=data.songs.flatMap(song=>song.charts.map(chart=>({song,chart,
    search:fold([song.title,song.artist,...song.aliases,chart.version,chart.creator,courses[chart.course]].join(' '))})));
  byUid=new Map(rows.map(row=>[row.chart.uid,row]));
  for(const [key,label] of Object.entries(courses))controls.course.add(new Option(label,key));
  const trails=Array.from(folders.keys(),id=>[id,folderTrail(id)]).sort((a,b)=>collator.compare(a[1],b[1]));
  for(const [id,trail] of trails)controls.folder.add(new Option(trail,id));
  controls.folder.add(new Option('未設定','@unassigned'));
  const totals=$('#totals');
  totals.append(pair('曲',fmt(data.songs.length)),pair('譜面',fmt(rows.length)),
    pair('封印譜面',fmt(rows.filter(row=>row.chart.route).length)));
  totals.hidden=false;
  render();openHash();
}
start().catch(()=>{
  status.replaceChildren('公開データを読み込めませんでした。 ',fieldLink('再読み込み',location.href));
});
