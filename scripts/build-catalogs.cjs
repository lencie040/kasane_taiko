const {readFileSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');
const {COURSE_ALIAS, norm, parseOsu, guessCourse} = require('../beatmap');
const {estimateKasaneDifficulty,chartRadarScores} = require('../difficulty');
const SealedRoute = require('../sealed-route');

const archivePath = path => String(path ?? '').normalize('NFC').replace(/\\/g,'/').replace(/^\.\//,'').toLowerCase();
const audioPattern = /\.(mp3|ogg|wav|m4a|aac|flac|opus|webm)$/;

function hasAudio(chart, files){
  const path = archivePath(chart.audio);
  const dir = chart.sourcePath.slice(0,chart.sourcePath.lastIndexOf('/')+1);
  const basename = value => value.split('/').at(-1).replace(/\s+/g,'');
  return !!path && (files.includes(dir+path)||files.includes(path)||files.some(file=>basename(file)===basename(path))) ||
    files.filter(file=>audioPattern.test(file)).length===1;
}

function readCharts(pack){
  const charts = [];
  const seen = new Set();
  for (const {entry,text} of pack.entries){
    let chart;
    try { chart = parseOsu(text); } catch { continue; }
    if (chart.mode===2 || chart.mode===3 || !chart.targets.length && !chart.rolls.length) continue;
    const pathVersion = /\[([^\]]*)\]\.osu$/i.exec(entry.path.normalize('NFC'))?.[1]?.trim();
    const version = (typeof entry.version==='string'&&entry.version.trim()) || chart.meta.version || pathVersion || '(無名)';
    chart.meta.version = version;
    for(let n=2; seen.has(norm(chart.meta.version)); n++) chart.meta.version = `${version} (${n})`;
    seen.add(norm(chart.meta.version));
    chart.sourcePath = archivePath(entry.path);
    chart.defCourse = COURSE_ALIAS[norm(entry.course)];
    chart.course = chart.defCourse==='sealed'?'sealed':chart.stats.chords?'kasane':chart.defCourse||guessCourse(chart);
    chart.uid = pack.song.key+'::'+chart.meta.version;
    const sealAt = (target,i) => {
      const notes = target.type==='single'?[target]:target.notes;
      if (notes.length>1 && (notes.length!==2||target.reqD!==1||target.reqK!==1||notes.some(n=>n.big))) return [];
      const id = i+':'+target.t+':'+notes.map(n=>n.color+(n.big?'B':'')).join('');
      const sides = entry.noise?.[id];
      return notes.map((_,j)=>sides?.[j]==='left'||sides?.[j]==='right'?sides[j]:null);
    };
    chart.seals = chart.targets.map(sealAt);
    chart.rating = estimateKasaneDifficulty(chart,chart.course,(_,i)=>chart.seals[i]);
    chart.route = chart.course==='sealed'?SealedRoute.parse(entry.sealedRoute):null;
    charts.push(chart);
  }
  return charts.filter(chart=>{
    if(chart.course!=='sealed')return true;
    const route = chart.route;
    const source = route && charts.find(base=>base.sourcePath===archivePath(route.sourcePath));
    if(!source||!SealedRoute.validSplit(route,source,chart)||!hasAudio(source,pack.files)) return false;
    chart.route = {...route,sourceUid:source.uid,sourceVersion:source.meta.version,sourceCourse:source.course};
    delete chart.route.sourcePath;
    return true;
  });
}

function databaseChart(chart){
  const {rating,stats,route,bpm,length,firstT,uid,course,meta,targets,rolls,seals} = chart;
  let don=0,ka=0,big=0;
  for(const target of targets)for(const note of target.type==='single'?[target]:target.notes){
    if(note.color==='d')don++;else ka++;
    if(note.big)big++;
  }
  return {uid,course,version:meta.version,creator:meta.creator,level:rating.level,bpm,length,firstT,
    notes:stats.notes,don,ka,big,chords:stats.chords,maxLanes:stats.maxLanes,
    rolls:rolls.filter(r=>r.type==='roll').length,balloons:rolls.filter(r=>r.type==='balloon').length,
    sealedNotes:seals.reduce((total,sides)=>total+sides.filter(Boolean).length,0),route,
    radar:chartRadarScores(rating)};
}

function matchChart(chart,pack){
  const {uid,course,length,firstT,rating,targets,rolls,seals} = chart;
  return {uid,title:pack.song.title,path:pack.path,hash:pack.hash,course,level:rating.level,length,firstT,
    targets:targets.map(({t,type,color,big},i)=>({t,type,color,big,noise:seals[i][0]??null})),
    rolls:rolls.map(({t,end,big,hits})=>({t,end,big,hits}))};
}

const {packs,folders,characters} = JSON.parse(readFileSync(0,'utf8'));
const matches=[],songs=[],folderMap=new Map();
for(const folder of folders.folders||[])if(folder?.id&&folder.name)folderMap.set(folder.id,folder);
for (const pack of packs){
  const {song,cover} = pack;
  for(const folder of Array.isArray(song.folderCatalog)?song.folderCatalog:[]){
    if(folder?.id&&folder.name&&!folderMap.has(folder.id))folderMap.set(folder.id,folder);
  }
  const charts=readCharts(pack);
  if(!charts.length)continue;
  for(const chart of charts){
    if(chart.course!=='sealed'&&chart.course!=='kasane'&&chart.targets.length)matches.push(matchChart(chart,pack));
  }
  const ids=Array.isArray(song.folders)?song.folders:folders.assignments?.[song.key];
  songs.push({key:song.key,title:song.title,artist:song.artist||'',aliases:Array.isArray(song.aliases)?song.aliases:[],
    cover,folders:[...new Set((Array.isArray(ids)?ids:[ids]).filter(id=>typeof id==='string'))], charts:charts.map(databaseChart)});
}
const output=process.argv[2];
writeFileSync(join(output,'content/match-catalog.json'),JSON.stringify({format:1,charts:matches}));
writeFileSync(join(output,'db/catalog.json'),JSON.stringify({format:1,songs,
  folders:[...folderMap.values()].map(({id,name,parent})=>({id,name,parent})),
  characters:characters.filter(c=>c.id),
  sealed:{potential:SealedRoute.requiredPotential,life:SealedRoute.life,
    ok:SealedRoute.life-SealedRoute.remaining(SealedRoute.life,'ok'),
    bad:SealedRoute.life-SealedRoute.remaining(SealedRoute.life,'bad')}}));
