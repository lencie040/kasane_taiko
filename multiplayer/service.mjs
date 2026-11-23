import rules from '../multiplayer-rules.js';

const WAIT_TIMEOUT = 20000;
const READY_TIMEOUT = 45000;
const START_DELAY = 4500;
const RESULT_TIME = 180000;
const HIT_WINDOW = 4500;
const ACTIONS = new Set(['status','join','ready','tick','leave']);
const TOKEN = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

export function deviceOf(agent,touch) {
  return /android|iphone|ipad|ipod|mobile/i.test(agent) || (/Macintosh/.test(agent)&&touch===true) ? 'mobile' : 'pc';
}

function chartInfo({uid,title,path,hash,course,level,length,firstT}) {
  return {uid,title,path,hash,course,level,length,firstT};
}

export class MatchService {
  constructor(store,catalog) {
    this.store = store;
    this.catalog = catalog;
    this.queue = Promise.resolve();
  }

  request(body,userAgent,now=Date.now()) {
    const run = this.queue.then(()=>this.handle(body,userAgent,now));
    this.queue = run.catch(()=>{ this.active = null; });
    return run;
  }

  async handle(body,userAgent,now) {
    if (!body || !ACTIONS.has(body.action) || typeof body.token!=='string' || !TOKEN.test(body.token)) {
      return {error:'対戦リクエストを確認できません。'};
    }
    this.active ??= await this.store.get('active') ?? {waiting:{},matches:{}};
    const changedProfiles = {};
    const { waiting,matches } = this.active;
    const token = body.token;
    let changed = this.sweep(now,changedProfiles);
    let match = Object.values(matches).find(room=>room.players.some(player=>player.token===token)&&room.result==null);
    let player = match?.players.find(p=>p.token===token);
    let profile = player?.profile ?? waiting[token]?.profile ?? await this.store.get('profile:'+token) ?? rules.freshProfile();

    if (body.action==='join' && !match) {
      if (body.mode!=='casual' && body.mode!=='ranked') return {error:'マッチの種類を確認してください。'};
      const device = deviceOf(userAgent,body.touch);
      const already = waiting[token];
      if (already?.mode!==body.mode || already.device!==device) {
        if (!already && Object.keys(waiting).length>=500) return {error:'対戦待機が混雑しています。'};
        waiting[token] = {token,profile,device,mode:body.mode,seen:now};
      } else already.seen=now;
      changed = true;
      const other = Object.values(waiting).find(p=>p.token!==token&&p.mode===body.mode&&p.device===device&&
        (body.mode==='casual'||rules.canMatch(profile,p.profile)));
      if (other && Object.values(matches).filter(room=>!room.result).length<32) {
        const chosen = rules.chooseChart(await this.catalog(),body.mode,[other.profile,profile]);
        if (!chosen) {
          delete waiting[token];
          await this.commit(this.active,changedProfiles);
          return {error:'条件に合う対戦譜面がありません。'};
        }
        const id = crypto.randomUUID();
        match = {id,created:now,mode:body.mode,device,chart:chosen,order:0,start:null,result:null,
          players:[other,waiting[token]].map(p=>({...p,seen:now,ready:false,done:false,batch:0,state:rules.newScore(),signal:null}))};
        matches[id] = match;
        delete waiting[token];
        delete waiting[other.token];
        player = match.players[1];
      }
    } else if (body.action==='leave') {
      if (waiting[token]) {
        delete waiting[token];
        changed = true;
      }
      if (match && (!body.match||match.id===body.match)) {
        this.finish(match,match.start&&now>=match.start?1-match.players.indexOf(player):null,now,changedProfiles,
          match.start&&now>=match.start?'forfeit':'cancelled');
        changed = true;
      }
    } else if (match && (body.action==='status' || match.id===body.match)) {
      player.seen = now;
      changed = true;
      if (body.action==='ready' && !match.start) {
        player.ready = true;
        if (match.players.every(p=>p.ready)) match.start=now+START_DELAY;
      }
      if (body.action==='tick') {
        if (typeof body.signal==='string' && body.signal.length<=30000 && !player.signal) player.signal=body.signal;
        this.inputs(match,player,body,now);
        if (match.start && now>=match.start+match.chart.length+1000 && body.done===true &&
            Number.isInteger(body.batch) && player.batch===body.batch) {
          player.done=true;
          if (match.players.every(p=>p.done)) this.finishScored(match,now,changedProfiles);
        }
      }
    } else if (waiting[token]) {
      waiting[token].seen = now;
      changed = true;
    }

    // A restarted tab can retrieve its last result without receiving another match's data.
    if (!match && (body.action==='status'||body.action==='tick'&&body.match) && !waiting[token]) {
      match = Object.values(matches).reverse().find(room=>room.result&&room.players.some(p=>p.token===token)
        && (!body.match||room.id===body.match));
    }
    if (changed) await this.commit(this.active,changedProfiles);
    profile=changedProfiles[token]??(match?.result && match.mode==='ranked' ? await this.store.get('profile:'+token) : null)??profile;
    return {now,profile,status:waiting[token]?'waiting':match?.result?'result':match?'match':'idle',
      ...(match?{match:this.view(match,token)}:{})};
  }

  view(match,token) {
    const seat = match.players.findIndex(p=>p.token===token);
    const player = match.players[seat];
    return {id:match.id,seat,mode:match.mode,device:match.device,chart:chartInfo(match.chart),start:match.start,
      ready:match.players.map(p=>p.ready),scores:match.players.map(p=>p.state.score),batch:player.batch,
      opponent:match.players[1-seat].profile.league,signal:match.players[1-seat].signal,result:match.result,
      opponentPlay:rules.playProgress(match.players[1-seat].state)};
  }

  inputs(match,player,body,now) {
    if (!match.start || player.done || body.batch!==player.batch+1 || !Array.isArray(body.hits) || body.hits.length>96) return;
    const elapsed = now-match.start;
    for (const hit of body.hits) {
      if (rules.acceptInput(player.state,match.chart,hit,match.order+1,match.device==='mobile',elapsed-HIT_WINDOW,elapsed+250)) {
        match.order++;
      }
    }
    player.batch=body.batch;
  }

  sweep(now,profiles) {
    let changed = false;
    for (const [token,p] of Object.entries(this.active.waiting)) {
      if (now-p.seen>WAIT_TIMEOUT) {
        delete this.active.waiting[token];
        changed=true;
      }
    }
    for (const room of Object.values(this.active.matches)) {
      if (room.result) {
        if (now-room.result.at>RESULT_TIME) {
          delete this.active.matches[room.id];
          changed=true;
        }
        continue;
      }
      const expired=room.players.map(p=>now-p.seen>WAIT_TIMEOUT);
      if ((!room.start&&now-room.created>READY_TIMEOUT) || expired.every(Boolean)) {
        this.finish(room,null,now,profiles,'cancelled');
        changed=true;
      } else if (expired.some(Boolean)) {
        this.finish(room,room.start&&now>=room.start?expired.indexOf(false):null,now,profiles,
          room.start&&now>=room.start?'forfeit':'cancelled');
        changed=true;
      } else if (room.start && now>=room.start+room.chart.length+8000) {
        this.finishScored(room,now,profiles);
        changed=true;
      }
    }
    return changed;
  }

  finishScored(room,now,profiles) {
    const scores=room.players.map(p=>p.state);
    this.finish(room,rules.winner(scores),now,profiles,'score');
  }

  finish(room,winner,now,profiles,reason) {
    const scores = room.players.map(p=>p.state.score);
    room.result = {winner,reason,at:now,tiebreak:reason==='score'&&winner!==null&&scores[0]===scores[1]};
    room.chart = chartInfo(room.chart);
    room.players.forEach((p,i)=>{
      p.state = {score:scores[i]};
      p.signal = null;
      if (room.mode==='ranked' && reason!=='cancelled') {
        const outcome=winner===null?.5:winner===i?1:0;
        profiles[p.token]=rules.advanceProfile(p.profile,room.players[1-i].profile,outcome,reason==='score');
      }
    });
  }

  commit(active,profiles) {
    const values = {active};
    for (const [token,profile] of Object.entries(profiles)) values['profile:'+token]=profile;
    return this.store.put(values);
  }
}
