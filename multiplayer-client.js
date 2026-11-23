'use strict';

function createTaikoMultiplayer(game) {
  const $ = id => document.getElementById(id);
  const {LEAGUES,GOALS} = TaikoMatchRules;
  const endpoint = globalThis.crypto?.randomUUID && (globalThis.KASANE_MATCH_ENDPOINT || (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? '/multiplayer' : ''));
  const touch = navigator.userAgentData?.mobile===true || navigator.maxTouchPoints>1;
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent)&&touch);
  const peerLobby = globalThis.crypto?.randomUUID && (!endpoint||globalThis.KASANE_PEER_OPTIONS) && typeof Peer==='function'
    ?createTaikoPeerLobby({device:mobile?'mobile':'pc',options:globalThis.KASANE_PEER_OPTIONS,namespace:globalThis.KASANE_PEER_NAMESPACE})
    :null;
  const available=!!(peerLobby||endpoint);
  const tokenKey = 'kt.multiplayer.token';
  let token;
  if (endpoint&&!peerLobby) {
    try {
      token = localStorage.getItem(tokenKey) || crypto.randomUUID();
      localStorage.setItem(tokenKey,token);
    } catch { token=crypto.randomUUID(); }
  }
  let clockOffset=0, bestRtt=Infinity;
  let mode=null, match=null, audio=null, profile=null, result=null, peer=null, channel=null;
  let signal=null, remoteSignal=false, peerScore=null, lastPeerSend=0;
  let starting=false, done=false, pending=[], outgoing=null, sequence=0;
  let occupied=false, timer=null, generation=0, controller=null, canceling=false;
  let retries=0;

  function text(value) { $('multiStatus').textContent=value; }

  function render() {
    $('multiDevice').textContent=(mobile?'スマホ・タブレット':'PC')+(peerLobby?' ・ P2P':'');
    $('multiRank').textContent=profile?LEAGUES[profile.league]:'ビギナーリーグ';
    const master=profile?.league===4;
    $('multiProgress').textContent=master?`レート ${profile.rating}`:`昇格ポイント ${profile?.points||0} / ${GOALS[profile?.league||0]}`;
    $('multiCasual').disabled=$('multiRanked').disabled=occupied || !available;
    $('multiCancel').hidden=!occupied;
    $('multiCancel').disabled=canceling;
    $('matchHud').hidden=!match?.start || result!==null;
    if (match?.start) {
      $('matchOwn').textContent=game.format(game.score() ?? match.scores[match.seat]);
      $('matchOther').textContent=game.format(Math.max(match.scores[1-match.seat],peerScore??0));
    }
  }

  async function request(action,fields={}) {
    if(peerLobby){
      const data=await peerLobby.request({action,...fields});
      clockOffset=data.now-performance.now();
      profile=data.profile;
      return data;
    }
    const time=performance.now();
    const abort=new AbortController();
    controller=abort;
    const timeout=setTimeout(()=>abort.abort(),7000);
    try {
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({action,token,touch,...fields}),signal:abort.signal});
      const data=await response.json();
      if (!response.ok||data.error) throw Error(data.error||'対戦サーバーに接続できません。');
      const finish=performance.now(), rtt=finish-time;
      if (rtt<bestRtt+8) {
        bestRtt=Math.min(rtt,bestRtt);
        clockOffset=data.now-(time+finish)/2;
      }
      profile=data.profile;
      return data;
    } finally {
      clearTimeout(timeout);
      if (controller===abort) controller=null;
    }
  }

  function closePeer() {
    channel?.close();
    peer?.close();
    peer=null;channel=null;
    signal=null;remoteSignal=false;peerScore=null;lastPeerSend=0;
  }

  function acceptChannel(connection,id) {
    channel=connection;
    connection.onmessage=event=>{
      if (match?.id!==id || typeof event.data!=='string' || event.data.length>10) return;
      const score=Number(event.data);
      // This provisional display is replaced by the verified server scores on the results screen.
      if (Number.isSafeInteger(score)&&score>=0&&score<=3000000 && score>=(peerScore??0)) {
        peerScore=score;
        render();
      }
    };
    connection.onclose=()=>{ if (connection===channel) { channel=null;peerScore=null;render(); } };
  }

  async function prepareDirect(room) {
    if (typeof RTCPeerConnection!=='function') return;
    try {
      peer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
      peer.ondatachannel=event=>acceptChannel(event.channel,room.id);
      if (room.seat===0) {
        acceptChannel(peer.createDataChannel('score',{ordered:false,maxRetransmits:0}),room.id);
        await localSignal(peer,await peer.createOffer());
      }
    } catch { closePeer(); }
  }

  async function localSignal(connection,sdp) {
    await connection.setLocalDescription(sdp);
    if (connection.iceGatheringState!=='complete') {
      await new Promise(resolve=>{
        const stop=()=>{
          clearTimeout(limit);
          connection.removeEventListener('icegatheringstatechange',changed);
          resolve();
        };
        const changed=()=>{if(connection.iceGatheringState==='complete')stop();};
        const limit=setTimeout(stop,1800);
        connection.addEventListener('icegatheringstatechange',changed);
      });
    }
    if (peer===connection) signal=connection.localDescription?.sdp||null;
  }

  async function readSignal(room) {
    if (!peer||!room.signal||remoteSignal) return;
    const connection=peer;
    remoteSignal=true;
    try {
      await connection.setRemoteDescription({type:room.seat===0?'answer':'offer',sdp:room.signal});
      if (room.seat===1) await localSignal(connection,await connection.createAnswer());
    } catch { if(peer===connection)closePeer(); }
  }

  function reset() {
    clearTimeout(timer);
    closePeer();
    occupied=false;canceling=false;starting=false;done=false;match=null;audio=null;mode=null;
    pending=[];outgoing=null;sequence=0;result=null;retries=0;
  }

  function schedule(ms=650) {
    clearTimeout(timer);
    const stamp=generation;
    timer=setTimeout(()=>{if(stamp===generation)poll();},ms);
  }

  function fail(error) {
    if (!occupied) return;
    retries++;
    text(retries>1?'対戦サーバーに再接続中…':error.message);
    if (retries>=12) {
      generation++;
      if (starting) game.stop();
      reset();
      text('対戦サーバーとの接続が切れました。');
      render();
      return;
    }
    schedule(Math.min(1800,500+retries*200));
  }

  async function poll() {
    const stamp=generation;
    try {
      let data;
      if (!match) data=await request('status');
      else if (audio&&!match.ready[match.seat]&&!match.start) data=await request('ready',{match:match.id});
      else {
        if (pending.length&&!outgoing) outgoing={batch:sequence+1,hits:pending.splice(0,96)};
        data=await request('tick',{match:match.id,batch:outgoing?.batch??sequence,hits:outgoing?.hits??[],
          done:done && !pending.length,signal});
        if (stamp!==generation) return;
        if (outgoing && data.match?.batch>=outgoing.batch) {
          sequence=outgoing.batch;
          outgoing=null;
        }
      }
      if (stamp!==generation) return;
      retries=0;
      await apply(data,stamp);
    } catch(error) { if (stamp===generation)fail(error); }
  }

  async function apply(data,stamp) {
    if (data.status==='result') {
      const room=data.match;
      if (match && room.id!==match.id) return;
      const active=starting;
      result=room.result;
      occupied=false;
      clearTimeout(timer);
      closePeer();
      if (active) game.result(room,profile);
      text(room.result.reason==='cancelled'?'対戦の準備を取り消しました。':'対戦が終了しました。');
      match=null;audio=null;starting=false;
      render();
      return;
    }
    if (data.status==='waiting') {
      text(`${mode==='ranked'?'ランク':'カジュアル'}マッチで相手を探しています…`);
      render();
      schedule(peerLobby?650:1100);
      return;
    }
    if (data.status!=='match') {
      reset();
      text(data.message||'対戦相手を探せます。');
      render();
      return;
    }

    const room=data.match;
    const first=match?.id!==room.id;
    match=room;
    if(!room.direct)void readSignal(room);
    if (first) {
      sequence=room.batch;
      text(`「${room.chart.title}」を読み込んでいます…`);
      if(!room.direct)void prepareDirect(room);
      void prepareAudio(room,stamp);
    }
    if (room.start && audio && !starting && !canceling) {
      starting=true;
      game.start(audio,room,room.start-clockOffset);
      text(`対戦中　${room.chart.title}`);
    } else if (!room.start && audio) text('相手の準備を待っています…');
    render();
    schedule(room.direct&&starting?90:audio||starting?600:1300);
  }

  async function prepareAudio(room,stamp) {
    try {
      const prepared=await game.prepare(room.chart);
      if (stamp!==generation || match?.id!==room.id) return;
      audio=prepared;
      if (!controller) schedule(0);
    } catch(error) {
      if (stamp!==generation) return;
      await cancel();
      text(error.message||'対戦曲を読み込めませんでした。');
    }
  }

  async function join(selected) {
    if (!available||occupied) return;
    reset();
    game.audio();
    stopRead();
    const stamp=++generation;
    occupied=true;mode=selected;
    bestRtt=Infinity;
    text(peerLobby?'対戦の待機所に接続しています…':'対戦サーバーに接続しています…');
    render();
    try {
      const data=await request('join',{mode});
      if(stamp===generation) await apply(data,stamp);
    } catch(error) {
      if (stamp!==generation) return;
      reset();text(error.message);render();
    }
  }

  async function cancel() {
    if (!occupied||canceling) return;
    canceling=true;
    const stamp=++generation;
    clearTimeout(timer);
    controller?.abort();
    try {
      const data=await request('leave',{match:match?.id});
      if (stamp===generation) await apply(data,stamp);
    } catch {
      if (stamp!==generation) return;
      if (starting) game.stop();
      reset();
      text('接続が切れたため対戦を終了しました。');
      render();
    }
    canceling=false;
    render();
  }

  function stopRead() { controller?.abort(); }

  async function visit() {
    if (!available||occupied||controller) return;
    const stamp=generation;
    try {
      const data=await request('status');
      if (stamp!==generation||occupied) return;
      if (data.status==='waiting'||data.status==='match') {
        occupied=true;
        mode=data.match?.mode||'casual';
        await apply(data,stamp);
      } else render();
    } catch { if(stamp===generation&&!occupied)text('対戦サーバーに接続できません。'); }
  }

  function hit(role,time) {
    if(!starting||done||result||canceling) return;
    pending.push([role,time]);
    const now=performance.now();
    if (channel?.readyState==='open' && now-lastPeerSend>90) {
      lastPeerSend=now;
      try{channel.send(String(game.score()));}catch{}
    }
  }

  function finish() {
    if(!starting||result) return;
    done=true;
    game.wait();
    if(!controller) schedule(0);
  }

  $('multiCasual').onclick=()=>join('casual');
  $('multiRanked').onclick=()=>join('ranked');
  $('multiCancel').onclick=cancel;
  if(!available) text('このブラウザではオンライン対戦を利用できません。');
  render();
  window.addEventListener('pagehide',()=>{
    closePeer();
    if(!occupied||!available)return;
    if(peerLobby){void peerLobby.request({action:'leave',match:match?.id});return;}
    fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},keepalive:true,
      body:JSON.stringify({action:'leave',token,touch,match:match?.id})}).catch(()=>{});
  });
  return {visit,cancel,hit,finish,render,opponentPlay:()=>match?.opponentPlay};
}
