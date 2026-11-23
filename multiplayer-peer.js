'use strict';

function createTaikoPeerLobby({device,options={},namespace='kasane-taiko-pvp-v1'}) {
  const rules=TaikoMatchRules;
  const SLOT_COUNT=16, READY_TIMEOUT=45000, START_DELAY=4500, FINISH_TIMEOUT=17000;
  const profileKey='kt.multiplayer.peer-profile-v1';
  const identityKey='kt.multiplayer.peer-id-v1';
  const elapsed=()=>performance.now();
  const wall=()=>performance.timeOrigin+elapsed();
  let identity=crypto.randomUUID();
  try{
    identity=localStorage.getItem(identityKey)||identity;
    localStorage.setItem(identityKey,identity);
  }catch{}
  let profile=readProfile(), catalog=null, session=null;
  let lastResult=null, notice=null;

  function validProfile(p) {
    return !!p && Number.isInteger(p.league)&&p.league>=0&&p.league<=4&&
      Number.isSafeInteger(p.rating)&&p.rating>=100;
  }

  function readProfile() {
    try {
      const stored=JSON.parse(localStorage.getItem(profileKey));
      if (validProfile(stored)&&Number.isSafeInteger(stored.points)&&stored.points>=0&&
          Number.isSafeInteger(stored.wins)&&stored.wins>=0&&Number.isSafeInteger(stored.played)&&stored.played>=0) return stored;
    } catch {}
    return rules.freshProfile();
  }

  async function loadCatalog() {
    if (catalog) return catalog;
    const response=await fetch('content/match-catalog.json',{cache:'no-cache'});
    if (!response.ok) throw Error('対戦譜面を読み込めません。');
    const data=await response.json();
    if (data?.format!==1||!Array.isArray(data.charts)||!data.charts.length) throw Error('対戦譜面がありません。');
    return catalog=data.charts;
  }

  function clock(s) { return wall()+s.offset; }
  function id(s,slot) { return `${namespace}-${s.mode}-${device}-${slot}`; }

  function clearPeer(s) {
    clearTimeout(s.claimTimer);
    clearTimeout(s.probeTimer);
    if (s.link) {
      clearTimeout(s.link.timer);
      s.link.connection.close();
      s.link=null;
    }
    const peer=s.peer;
    s.peer=null;
    peer?.destroy();
  }

  function stop(s,message) {
    if (session!==s) return;
    session=null;
    notice=message;
    clearPeer(s);
  }

  function claim(s,slot) {
    if (session!==s) return;
    if (slot===SLOT_COUNT) {
      stop(s,'対戦の待機枠が満員です。少し待ってからもう一度お試しください。');
      return;
    }
    const peer=new Peer(id(s,slot),options);
    s.peer=peer;
    s.slot=slot;
    s.claimTimer=setTimeout(()=>stop(s,'PeerJS の公開仲介に接続できません。'),12000);
    let opened=false;
    peer.on('open',()=>{
      if (s.peer!==peer||session!==s) return;
      clearTimeout(s.claimTimer);
      opened=true;
      s.scanSlot=slot+1;
      scan(s,0);
    });
    peer.on('connection',connection=>{
      if (s.peer!==peer||session!==s) { connection.close();return; }
      const linked=connection.peer;
      const valid=Array.from({length:slot},(_,i)=>id(s,i)).includes(linked);
      if (!valid||s.room||s.link&&!s.link.host) { connection.close();return; }
      if (s.link) release(s,s.link);
      bind(s,connection,false);
    });
    peer.on('error',error=>{
      if(s.peer!==peer||session!==s) return;
      if(error.type==='unavailable-id'&&!opened) {
        clearTimeout(s.claimTimer);
        s.peer=null;
        peer.destroy();
        claim(s,slot+1);
      } else if(error.type==='peer-unavailable') {
        if(s.link?.host&&!s.link.connection.open&&!s.room) release(s,s.link);
      } else if(error.type==='webrtc'&&s.link&&!s.room) {
        release(s,s.link);
      } else if (!s.room && !s.link?.connection.open) stop(s,'PeerJS の公開仲介との接続が切れました。');
    });
    peer.on('disconnected',()=>{
      if(s.peer===peer&&session===s&&!s.room&&!s.link?.connection.open) {
        stop(s,'PeerJS の公開仲介との接続が切れました。');
      }
    });
  }

  function scan(s,delay=480) {
    clearTimeout(s.probeTimer);
    if (session!==s||s.link||s.room||s.slot>=SLOT_COUNT-1||!s.peer?.open) return;
    s.probeTimer=setTimeout(()=>{
      if (session!==s||s.link||s.room||!s.peer?.open) return;
      const target=s.scanSlot;
      s.scanSlot=target+1<SLOT_COUNT?target+1:s.slot+1;
      bind(s,s.peer.connect(id(s,target),{serialization:'json',reliable:true,label:'kasane-match-v1'}),true);
    },delay);
  }

  function release(s,link) {
    if(s.link!==link) return;
    s.link=null;
    clearTimeout(link.timer);
    link.connection.close();
    if (s.room&&!s.room.result) {
      finish(s,null,'cancelled');
    } else if (!s.room) scan(s);
  }

  function send(s,message) {
    if (!s.link?.connection.open) return false;
    try { s.link.connection.send(message); return true; } catch { return false; }
  }

  function bind(s,connection,host) {
    clearTimeout(s.probeTimer);
    const link={connection,host,other:null,offer:null,timer:null};
    s.link=link;
    link.timer=setTimeout(()=>release(s,link),9000);
    connection.on('open',()=>{
      if(s.link!==link) return;
      send(s,{type:'hello',device,identity,league:profile.league,rating:profile.rating});
    });
    connection.on('data',message=>{
      if(s.link!==link||!message||typeof message.type!=='string') return;
      receive(s,link,message);
    });
    connection.on('close',()=>release(s,link));
    connection.on('error',()=>release(s,link));
  }

  function receive(s,link,message) {
    if (message.type==='hello'&&!link.other) {
      const opponent={league:message.league,rating:message.rating};
      if (message.device!==device||typeof message.identity!=='string'||message.identity.length!==36||
          message.identity===identity||!validProfile(opponent)||(s.mode==='ranked'&&!rules.canMatch(profile,opponent))) {
        release(s,link);
        return;
      }
      link.other=opponent;
      if (link.host) {
        const chart=rules.chooseChart(catalog,s.mode,[profile,opponent]);
        if(!chart){stop(s,'条件に合う対戦譜面がありません。');return;}
        link.offer={id:crypto.randomUUID(),chart};
        send(s,{type:'offer',id:link.offer.id,uid:chart.uid,hash:chart.hash});
      }
      return;
    }
    if (!link.other) return;
    if (message.type==='offer'&&!link.host&&!link.offer&&typeof message.id==='string'&&message.id.length===36) {
      const chart=rules.chartChoices(catalog,s.mode,[link.other,profile]).find(row=>row.uid===message.uid&&row.hash===message.hash);
      if(!chart){release(s,link);return;}
      link.offer={id:message.id,chart};
      send(s,{type:'accept',id:message.id});
    } else if (message.type==='accept'&&link.host&&link.offer?.id===message.id&&!s.room) {
      startRoom(s,link);
      send(s,{type:'paired',id:message.id});
    } else if (message.type==='paired'&&!link.host&&link.offer?.id===message.id&&!s.room) {
      startRoom(s,link);
    }
    const room=s.room;
    if (!room||room.result||message.id!==room.id) return;
    switch(message.type) {
      case 'ping':
        if(link.host&&Number.isFinite(message.at))send(s,{type:'pong',id:room.id,at:message.at,wall:wall()});
        break;
      case 'pong':
        if(!link.host&&message.at===s.pingAt&&Number.isFinite(message.wall)){
          const rtt=elapsed()-message.at;
          if (rtt<s.bestRtt+6) {
            s.offset=message.wall-(wall()-rtt/2);
            s.bestRtt=Math.min(rtt,s.bestRtt);
          }
        }
        break;
      case 'ready':
        room.ready[1-room.seat]=true;
        startIfReady(s);
        break;
      case 'start':
        if(!link.host&&!room.start&&room.ready.every(Boolean)&&Number.isFinite(message.start)&&
          Math.abs(clock(s)+START_DELAY-message.start)<START_DELAY) room.start=message.start;
        break;
      case 'hits':
        acceptBatch(s,1-room.seat,message);
        break;
      case 'leave':
        finish(s,room.start&&clock(s)>=room.start?room.seat:null,room.start&&clock(s)>=room.start?'forfeit':'cancelled');
        break;
    }
  }

  function startRoom(s,link) {
    clearTimeout(link.timer);
    s.room={...link.offer,seat:link.host?0:1,mode:s.mode,device,created:wall(),ready:[false,false],start:null,
      players:[0,1].map(()=>({score:rules.newScore(),batch:0,done:false})),result:null};
    // Existing WebRTC connections are independent of the broker after pairing.
    s.peer.disconnect();
  }

  function startIfReady(s) {
    const room=s.room;
    if (!s.link?.host||room.start||!room.ready.every(Boolean)) return;
    room.start=wall()+START_DELAY;
    send(s,{type:'start',id:room.id,start:room.start});
  }

  function acceptBatch(s,seat,data) {
    const room=s.room, player=room.players[seat];
    if (!room.start||room.result||player.done||!Number.isSafeInteger(data.batch)) return;
    if (data.batch===player.batch+1&&Array.isArray(data.hits)&&data.hits.length<=96) {
      for (const hit of data.hits) rules.acceptInput(player.score,room.chart,hit,null,device==='mobile',-Infinity,Infinity);
      player.batch=data.batch;
    }
    if(data.done===true&&player.batch===data.batch&&clock(s)>=room.start+room.chart.length+700) player.done=true;
    if(room.players.every(p=>p.done)) {
      finish(s,rules.winner(room.players.map(p=>p.score),false),'score');
    }
  }

  function finish(s,winner,reason) {
    const room=s.room;
    if (!room||room.result) return;
    const [a,b]=room.players.map(p=>p.score.score);
    room.result={winner,reason,tiebreak:reason==='score'&&winner!==null&&a===b};
    if (room.mode==='ranked'&&reason!=='cancelled'&&s.link?.other) {
      profile=rules.advanceProfile(profile,s.link.other,winner===null?.5:winner===room.seat?1:0,reason==='score');
      try { localStorage.setItem(profileKey,JSON.stringify(profile)); } catch {}
    }
    lastResult=view(s);
    session=null;
    // Let the final reliable packet reach the opponent before closing the data channel.
    setTimeout(()=>clearPeer(s),2000);
  }

  function view(s) {
    const {id,seat,mode,chart,start,ready,result,players}=s.room;
    const {uid,title,path,hash,course,level,length,firstT}=chart;
    return {id,seat,mode,device,direct:true,start,ready,result,chart:{uid,title,path,hash,course,level,length,firstT},
      scores:players.map(p=>p.score.score),batch:players[seat].batch,opponent:s.link?.other?.league,
      opponentPlay:rules.playProgress(players[1-seat].score)};
  }

  async function request(body) {
    const s=session;
    if (body.action==='join'&&!s) {
      if (typeof Peer!=='function') throw Error('このブラウザでは PeerJS を読み込めません。');
      profile=readProfile();
      const next={mode:body.mode,peer:null,room:null,link:null,offset:0,bestRtt:Infinity, pingAt:null};
      session=next;
      lastResult=null;notice=null;
      try {
        await loadCatalog();
        if(session===next) claim(next,0);
      } catch(error) {
        if(session===next)stop(next,error.message);
      }
    } else if (body.action==='leave'&&s) {
      if(s.room) {
        send(s,{type:'leave',id:s.room.id});
        const started=s.room.start&&clock(s)>=s.room.start;
        finish(s,started?1-s.room.seat:null,started?'forfeit':'cancelled');
      } else stop(s,'マッチングを取り消しました。');
    } else if (s?.room&&body.match===s.room.id) {
      const room=s.room, other=1-room.seat;
      if (body.action==='ready') {
        if(room.seat===1&&!Number.isFinite(s.bestRtt)) {
          s.pingAt=elapsed();
          send(s,{type:'ping',id:room.id,at:s.pingAt});
        } else {
          room.ready[room.seat]=true;
          send(s,{type:'ready',id:room.id});
          startIfReady(s);
        }
      } else if (body.action==='tick') {
        if (room.start&&(body.done||body.hits?.length)) {
          const packet={type:'hits',id:room.id,batch:body.batch,hits:body.hits,done:body.done};
          if (send(s,packet)) acceptBatch(s,room.seat,packet);
        }
        if (room.start&&clock(s)>room.start+room.chart.length+FINISH_TIMEOUT&&!room.players[other].done) finish(s,null,'cancelled');
      }
    }
    const active=session;
    if (active?.room&&!active.room.start&&wall()-active.room.created>READY_TIMEOUT) {
      send(active,{type:'leave',id:active.room.id});
      finish(active,null,'cancelled');
    }
    if (session?.room) return {now:clock(session),profile,status:'match',match:view(session)};
    if (session) return {now:wall(),profile,status:'waiting'};
    if (lastResult&&(body.match===lastResult.id||body.action==='leave')) return {now:wall(),profile,status:'result',match:lastResult};
    return {now:wall(),profile,status:'idle',message:notice};
  }

  return {request};
}
