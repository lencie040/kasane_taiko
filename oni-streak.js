'use strict';

const OniStreak = (() => {
  const STAGES = {
    normal:[1,2,3,4,5,6,7,8,9,10],
    hard:[5,6,7,8,9,10,10,10,10,10],
  };
  const EPSILON = 1e-6;

  function starBand(level) {
    return Number.isFinite(level)?Math.floor(Math.round(level*10)/10):null;
  }

  function groupCharts(charts) {
    const groups=new Map();
    for(const chart of charts){
      const star=starBand(chart.level);
      if(star<1||star>10||chart.course==='kasane'||chart.set.demo||!chart.stats.notes)continue;
      if(!groups.has(star))groups.set(star,new Map());
      const songs=groups.get(star), key=chart.set.key;
      if(!songs.has(key))songs.set(key,[]);
      songs.get(key).push(chart);
    }
    return groups;
  }

  // A pick must leave a different song available for every remaining stage.
  function canComplete(pools,used) {
    const assigned=new Map();
    function findSong(stage,seen){
      for(const key of pools[stage].keys()){
        if(used.has(key)||seen.has(key))continue;
        seen.add(key);
        if(!assigned.has(key)||findSong(assigned.get(key),seen)){
          assigned.set(key,stage);
          return true;
        }
      }
      return false;
    }
    return pools.every((_,i)=>findSong(i,new Set()));
  }

  function pickCharts(groups,stars,used,random=Math.random) {
    if(!stars.length)return [];
    const [current,...later]=stars.map(star=>groups.get(star)||new Map());
    const options=[];
    for(const [key,charts] of current){
      if(used.has(key))continue;
      const picked=new Set(used).add(key);
      if(canComplete(later,picked))options.push(charts);
    }
    // Pick up to three distinct songs before choosing a chart variant for each.
    const choices=[];
    while(options.length&&choices.length<3){
      const [chartPool]=options.splice(Math.floor(random()*options.length),1);
      choices.push(chartPool[Math.floor(random()*chartPool.length)]);
    }
    return choices;
  }

  function canClear(st,required) {
    const ability=st.ab?.fx;
    const gain=ability?ability.gain*ability.gainClear:1;
    return st.gauge+Math.max(0,st.notes-st.judged)*st.gu*gain+EPSILON>=required;
  }

  function cleared(st,required) {
    return st.gauge+EPSILON>=required;
  }

  return {STAGES,starBand,groupCharts,pickCharts,canClear,cleared};
})();

if(typeof module==='object')module.exports=OniStreak;
