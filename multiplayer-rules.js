'use strict';

const TaikoMatchRules = (() => {
  const WIN_SOFT = {good:42,ok:108,bad:125};
  const WIN_HARD = {good:25,ok:75,bad:108};
  const COLORS = ['k','d','d','k'];
  const LEAGUES = ['ビギナーリーグ','スーパーリーグ','ハイパーリーグ','エリートリーグ','マスターリーグ'];
  const GOALS = [12,18,24,30];
  const START_RATING = 1000;
  const LOW_MASTER = 1150;
  const BANDS = [[1,4.9],[3,6.9],[5,8.9],[7,10.9]];
  const freshProfile = () => ({league:0,points:0,rating:START_RATING,wins:0,played:0});

  function canMatch(a,b) {
    if (Math.abs(a.league-b.league)>1) return false;
    if (a.league===4 && b.league===4) return Math.abs(a.rating-b.rating)<=300;
    if (a.league===4 || b.league===4) return (a.league===4?a:b).rating<=LOW_MASTER;
    return true;
  }

  function band(profile) {
    if (profile.league<4) return BANDS[profile.league];
    const center = Math.max(8.2,Math.min(12.2,8.5+(profile.rating-START_RATING)/160));
    return [center-1.2,center+1.0];
  }

  function chartChoices(charts,mode,players) {
    const [first,second] = players.map(band);
    const min = mode==='casual'?1:Math.max(first[0],second[0]);
    const max = mode==='casual'?7.9:Math.min(first[1],second[1]);
    let choices = charts.filter(chart=>chart.level>=min-1e-9 && chart.level<=max+1e-9);
    if (!choices.length && mode==='ranked') {
      const distance = chart => Math.max(0,min-chart.level,chart.level-max);
      const nearest = Math.min(...charts.map(distance));
      choices = charts.filter(chart=>distance(chart)<=nearest+1e-9);
    }
    return choices;
  }

  function chooseChart(charts,mode,players,random=Math.random) {
    const choices = chartChoices(charts,mode,players);
    return choices[Math.floor(random()*choices.length)] ?? null;
  }

  function advanceProfile(profile,opponent,outcome,completed) {
    const next = {...profile};
    next.played++;
    if (outcome===1) next.wins++;
    if (profile.league===4) {
      const other = opponent.league===4?opponent.rating:START_RATING;
      const expected = 1/(1+10**((other-profile.rating)/400));
      next.rating = Math.max(100,profile.rating+Math.round(32*(outcome-expected)));
    } else if (completed) {
      next.points += outcome===1?2:1;
      if (next.points>=GOALS[profile.league]) {
        next.league++;
        next.points = 0;
      }
    }
    return next;
  }

  function nearestTarget(run,t,color,stream=false,solo=false){
    const W=run.win,T=run.targets;
    let target=null,distance=Infinity,firstMatching=null,matching=null,matchingGood=false,next=null;
    for(let i=run.cursor;i<T.length;i++){
      const x=T[i],off=x.t-t;
      if(off>W.bad||(!stream&&off>distance))break;
      if(x.judged||off< -W.bad)continue;
      if(solo&&off>0)next??=x;
      const d=Math.abs(off);
      if(d<distance||(d===distance&&target.type==='single'&&target.color!==color&&(x.type==='chord'||x.color===color))){
        target=x;distance=d;
      }
      if(stream&&x.type==='single'&&x.color===color&&d<=W.ok){
        firstMatching??=x;
        if(!matching||(!matchingGood&&d<=W.good)){matching=x;matchingGood=d<=W.good;}
      }
    }
    if(!matching||target.type!=='single')return target;
    // 次の同色ノーツの直前まで、まだ可に入る手前のノーツを優先する。
    if(target.color===color){
      if(firstMatching.t<t&&t<target.t&&distance>=(target.t-firstMatching.t)/4)return firstMatching;
      return matching;
    }
    // 次の異色ノーツがまだ判定線に届いていない間は、手前の同色を優先する。
    if(matchingGood||distance>W.good||(matching.t<t&&t<target.t))return matching;
    // ソロのタップでは、直前の別色に近いだけで次の密集ノーツを奪わない。
    // 判定線付近の色間違いや、間に別のノーツがある場合は通常通り。
    if(solo&&matching===next&&target.t<t&&distance>=8&&
      matching.t-target.t<=60&&matching.t-t<=50)return matching;
    return target;
  }

  function oldestTarget(run,t,after=-Infinity){
    const {targets,win,cursor}=run;
    for(let i=cursor;i<targets.length;i++){
      const target=targets[i],offset=target.t-t;
      if(offset>win.bad)break;
      if(!target.judged&&target.t>after&&offset>=-win.bad)return target;
    }
    return null;
  }

  function newScore() {
    return {score:0,reached:null,sequence:null,cursor:0,judged:{},rolls:{},combo:0,effect:null,absorb:null,last:null,keys:[null,null,null,null]};
  }

  function scoreInput(state,chart,role,time,sequence,mobile) {
    const color = COLORS[role];
    const win = chart.course==='easy'||chart.course==='normal'?WIN_SOFT:WIN_HARD;
    const targets = [];
    // The same mobile targeting heuristic as solo play, with independent state per player.
    const source = chart.targets;
    while (state.cursor<source.length && time-source[state.cursor].t>win.bad) {
      const index=state.cursor++;
      if (!state.judged[index]) {
        state.combo=0;
        const missedAt=source[index].t+win.bad;
        if (!state.effect||missedAt>=state.effect.time) state.effect={kind:'bad',time:missedAt};
      }
      delete state.judged[index];
    }
    for (let i=state.cursor;i<source.length && source[i].t-time<=win.bad;i++) {
      targets.push({...source[i],index:i,judged:!!state.judged[i]});
    }
    const target = nearestTarget({win,targets,cursor:0},time,color,mobile);
    const award = points => {
      if (points<=0) return;
      state.score += points;
      state.reached = time;
      state.sequence = sequence;
    };
    const absorb = state.absorb;
    if (absorb && absorb.color===color && absorb.role!==role && time>=absorb.time && time-absorb.time<=30
        && (!target || Math.abs(time-absorb.noteTime)<Math.abs(time-target.t))) {
      state.absorb = null;
      award(absorb.points);
      return;
    }
    const rollIndex = chart.rolls.findIndex((roll,index)=>time>=roll.t && time<=roll.end && (!roll.hits||(state.rolls[index]||0)<roll.hits));
    if (!target || (rollIndex!==-1 && Math.abs(time-target.t)>win.ok)) {
      if (rollIndex===-1) return;
      const roll = chart.rolls[rollIndex];
      if (!roll.hits) {
        award(roll.big?200:100);
        state.effect={kind:'roll',time};
      } else if (color==='d') {
        const count = (state.rolls[rollIndex]||0)+1;
        state.rolls[rollIndex] = count;
        award(count===roll.hits?5300:300);
        state.effect={kind:'roll',time};
      }
      return;
    }
    const distance = Math.abs(time-target.t);
    const blocked=target.noise===(role<2?'left':'right');
    const kind=blocked||target.color!==color||distance>win.ok?'bad':distance<=win.good?'good':'ok';
    state.effect={kind,time};
    state.judged[target.index]=state.effect;
    state.combo=kind==='bad'?0:(state.combo||0)+1;
    if (kind==='bad') return;
    const base = Math.ceil(1000000/Math.max(1,source.length)/10)*10;
    const points = kind==='good'?base:Math.floor(base/20)*10;
    award(points);
    if (target.big&&!target.noise) state.absorb = {color,role,time,noteTime:target.t,points};
  }

  function acceptInput(state,chart,hit,sequence,mobile,minTime,maxTime) {
    if (!Array.isArray(hit)||hit.length!==2) return false;
    const [role,time]=hit;
    if (!Number.isInteger(role)||role<0||role>=COLORS.length||!Number.isInteger(time)||
        time<Math.max(minTime,Math.min(-1500,chart.firstT-160))||time>Math.min(chart.length+200,maxTime)||
        (state.last!==null&&time<state.last)||(state.keys[role]!==null&&time-state.keys[role]<12)) return false;
    state.last=time;
    state.keys[role]=time;
    scoreInput(state,chart,role,time,sequence,mobile);
    return true;
  }

  function winner(scores,arrivalOrder=true) {
    if (scores[0].score!==scores[1].score) return scores[0].score>scores[1].score?0:1;
    if (!scores[0].score) return null;
    if (scores[0].reached!==scores[1].reached) return scores[0].reached<scores[1].reached?0:1;
    return arrivalOrder?(scores[0].sequence<scores[1].sequence?0:1):null;
  }

  function playProgress(state) {
    return {cursor:state.cursor??0,judged:{...state.judged},rolls:{...state.rolls},combo:state.combo??0,effect:state.effect??null};
  }

  return {WIN_SOFT,WIN_HARD,COLORS,LEAGUES,GOALS,freshProfile,canMatch,chartChoices,chooseChart,advanceProfile,
    nearestTarget,oldestTarget,newScore,scoreInput,acceptInput,winner,playProgress};
})();

if (typeof module === 'object') module.exports = TaikoMatchRules;
