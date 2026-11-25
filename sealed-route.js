'use strict';

const SealedRoute = (() => {
  const requiredPotential = 9;
  const life = 100;

  function parse(value) {
    if(!value||typeof value.sourcePath!=='string'||!value.sourcePath||
       !Number.isInteger(value.at)||value.at<=0||
       !(value.character===null||typeof value.character==='string'&&value.character.length)||
       !Number.isInteger(value.minLevel)||value.minLevel<1||value.minLevel>100||
       !Number.isInteger(value.maxBad)||value.maxBad<0||
       !Number.isInteger(value.maxOk)||value.maxOk<0)return null;
    const {sourcePath,at,character,minLevel,maxBad,maxOk,minCombo=0}=value;
    if(!Number.isSafeInteger(minCombo)||minCombo<0)return null;
    return {sourcePath,at,character,minLevel,maxBad,maxOk,minCombo};
  }

  const ordinary = c => c && c.course!=='sealed' && c.course!=='kasane' &&
    c.defCourse!=='sealed' && c.defCourse!=='kasane' && !c.stats.chords;

  function validSplit(route,source,target) {
    return ordinary(source)&&route.at<source.length&&source.targets.some(t=>t.t<route.at)&&
      target.targets.some(t=>t.t>=route.at);
  }

  function qualifies(route,character,level,targets) {
    if((character?.id??null)!==route.character||(character&&level<route.minLevel))return false;
    let bad=0,ok=0,combo=0,maxCombo=0;
    for(const note of targets){
      if(note.t>=route.at)break;
      if(!note.judged||note.res==='bad'){
        bad++;combo=0;
      }else{
        if(note.res==='ok')ok++;
        maxCombo=Math.max(maxCombo,++combo);
      }
      if(bad>route.maxBad||ok>route.maxOk)return false;
    }
    return maxCombo>=(route.minCombo??0);
  }

  const remaining = (value,kind,count=1) => Math.max(0,value-count*(kind==='bad'?20:kind==='ok'?2:0));
  return {parse,ordinary,validSplit,qualifies,remaining,requiredPotential,life};
})();

if(typeof module==='object')module.exports=SealedRoute;
