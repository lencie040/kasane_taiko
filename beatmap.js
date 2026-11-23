'use strict';

const COURSE_ORDER=['easy','normal','hard','oni','ura','kasane'];
const COURSE_ALIAS={easy:'easy',kantan:'easy','かんたん':'easy','簡単':'easy',normal:'normal',futsuu:'normal','ふつう':'normal','普通':'normal',hard:'hard',muzukashii:'hard','むずかしい':'hard','難しい':'hard',oni:'oni','おに':'oni','鬼':'oni',ura:'ura','inner oni':'ura','ura oni':'ura','裏':'ura','おに裏':'ura','裏おに':'ura','裏鬼':'ura','鬼裏':'ura',kasane:'kasane','重':'kasane','かさね':'kasane',special:'kasane'};

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function norm(s){return String(s??'').normalize('NFKC').toLowerCase().replace(/\.(osz|zip|ktz)$/,'').replace(/\s+/g,' ').trim();}

function diffRange(d,min,mid,max){return d>5?mid+(max-mid)*(d-5)/5:d<5?mid-(mid-min)*(5-d)/5:mid;}
function segAt(segs,t){if(!segs.length)return null;if(t<segs[0].time)return segs[0];let lo=0,hi=segs.length-1,a=0;while(lo<=hi){const m=(lo+hi)>>1;if(segs[m].time<=t+1){a=m;lo=m+1;}else hi=m-1;}return segs[a];}

function parseOsu(text){
  let cur=null;const kv={General:{},Metadata:{},Difficulty:{}},lists={Events:[],TimingPoints:[],HitObjects:[]};
  for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('//'))continue;
    const m=/^\[(\w+)\]$/.exec(line);if(m){cur=m[1];continue;}
    if(kv[cur]){let i=line.indexOf(':');if(i<0)i=line.indexOf('：');if(i>0)kv[cur][line.slice(0,i).trim()]=line.slice(i+1).trim();}
    else if(lists[cur])lists[cur].push(line);}
  const G=kv.General,M=kv.Metadata,Df=kv.Difficulty;
  const mode=parseInt(G.Mode||'0')||0,sm=parseFloat(Df.SliderMultiplier||'1.4')||1.4,od=parseFloat(Df.OverallDifficulty??Df.HPDrainRate??'5');
  const tps=lists.TimingPoints.map(l=>{const p=l.split(',');const bl=parseFloat(p[1]);const unin=p.length>6?p[6].trim()==='1':bl>0;return{time:parseFloat(p[0]),bl,meter:parseInt(p[2])||4,unin,eff:parseInt(p[7]||'0')||0};}).filter(t=>isFinite(t.time)&&isFinite(t.bl));
  tps.sort((a,b)=>a.time-b.time||(b.unin-a.unin));
  const reds=tps.filter(t=>t.unin&&t.bl>0);if(!reds.length)throw new Error('BPM（赤線）がありません');
  const segs=[];let red=reds[0],sv=1;
  for(const t of tps){if(t.unin){if(t.bl<=0)continue;red=t;sv=1;}else sv=t.bl<0?clamp(-100/t.bl,.1,10):1;
    segs.push({time:t.time,rt:red.time,bl:red.bl,meter:red.meter,sv,kiai:!!(t.eff&1)});}
  const spd=s=>(60000/s.bl)*s.sv/240000;
  const notes=[],rolls=[];
  for(const l of lists.HitObjects){const p=l.split(',');if(p.length<5)continue;
    const x=+p[0],y=+p[1],t=Math.round(+p[2]),type=parseInt(p[3])||0,hs=parseInt(p[4])||0;if(!isFinite(t))continue;
    const big=!!(hs&4),ka=!!(hs&10),seg=segAt(segs,t);
    if(type&1)notes.push({t,x,y,color:ka?'k':'d',big});
    else if(type&2){const slides=parseInt(p[6])||1,len=parseFloat(p[7])||0;const dur=len/(sm*100*seg.sv)*seg.bl*slides;rolls.push({type:'roll',t,end:t+Math.max(dur,40),big,speed:spd(seg)});}
    else if(type&8){const end=Math.max(t+100,parseInt(p[5])||t+500);const hm=diffRange(od,3,5,7.5)*1.65;rolls.push({type:'balloon',t,end,hits:Math.max(1,Math.floor((end-t)/1000*hm)),speed:spd(seg)});}}
  notes.sort((a,b)=>a.t-b.t||a.y-b.y||a.x-b.x);
  const targets=[];let trimmed=0,maxLanes=1,chords=0,chordNotes=0,total=0;
  for(let i=0;i<notes.length;){let j=i+1;while(j<notes.length&&notes[j].t-notes[i].t<=2)j++;
    const grp=notes.slice(i,j);i=j;const seg=segAt(segs,grp[0].t),speed=spd(seg);
    let cd=0,ck=0;const kept=[];
    for(const n of grp){const cost=n.big?2:1;if(n.color==='d'){if(cd+cost>2){trimmed++;continue;}cd+=cost;}else{if(ck+cost>2){trimmed++;continue;}ck+=cost;}kept.push(n);}
    if(kept.length===1){const n=kept[0];targets.push({type:'single',t:n.t,color:n.color,big:n.big,speed});total++;continue;}
    targets.push({type:'chord',t:grp[0].t,notes:kept.map((n,k)=>({color:n.color,big:n.big,lane:k})),reqD:cd,reqK:ck,speed});
    chords++;chordNotes+=kept.length;total+=kept.length;maxLanes=Math.max(maxLanes,kept.length);}
  rolls.sort((a,b)=>a.t-b.t);
  const lastT=Math.max(targets.length?targets[targets.length-1].t:0,...rolls.map(r=>r.end),0);
  const firstT=Math.min(targets.length?targets[0].t:Infinity,rolls.length?rolls[0].t:Infinity);
  const bars=[];
  reds.forEach((r,i)=>{const end=i+1<reds.length?reds[i+1].time:lastT+3000;const ml=r.bl*r.meter;if(ml<=0)return;let k=0;
    for(let tt=r.time;tt<end-1&&bars.length<20000;tt+=ml,k++){if(k===0&&(r.eff&8))continue;bars.push({t:tt,speed:spd(segAt(segs,tt))});}});
  const bpms=reds.filter((r,i)=>r.time<=lastT||i===0).map(r=>Math.round(60000/r.bl*10)/10);
  let bg=null;for(const e of lists.Events){const m=/^0\s*,\s*[-\d.]+\s*,\s*"?([^",]+)"?/.exec(e);if(m){bg=m[1].trim();break;}}
  return{meta:{title:M.Title||'',titleU:M.TitleUnicode||'',artist:M.Artist||'',artistU:M.ArtistUnicode||'',creator:M.Creator||'',version:M.Version||'',setId:parseInt(M.BeatmapSetID)||0},
    audio:G.AudioFilename||'',preview:Number.isFinite(parseInt(G.PreviewTime))?parseInt(G.PreviewTime):-1,mode,od,segs,targets,rolls,bars,bg,length:lastT,firstT:isFinite(firstT)?firstT:0,
    bpm:[Math.min(...bpms),Math.max(...bpms)],stats:{notes:total,chords,chordNotes,maxLanes:Math.min(4,maxLanes),trimmed}};
}
function guessCourse(c){const v=norm(c.meta.version);
  if(/kantan|easy|かんたん|簡単/.test(v))return'easy';if(/futsuu|normal|ふつう|普通/.test(v))return'normal';
  if(/muzukashii|muzu|hard|むずかし|難し/.test(v))return'hard';if(/inner|ura|裏/.test(v))return'ura';if(/oni|おに|鬼/.test(v))return'oni';
  const nps=c.stats.notes/Math.max(1,(c.length-c.firstT)/1000);return nps<1.6?'easy':nps<2.6?'normal':nps<4?'hard':'oni';}

if (typeof module === 'object') module.exports = { COURSE_ORDER, COURSE_ALIAS, norm, parseOsu, guessCourse };
