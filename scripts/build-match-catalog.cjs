const { readFileSync } = require('node:fs');
const { COURSE_ALIAS, norm, parseOsu, guessCourse } = require('../beatmap');
const { estimateKasaneDifficulty } = require('../difficulty');

const packs = JSON.parse(readFileSync(0, 'utf8'));
const charts = [];
for (const pack of packs) {
  const seen = new Set();
  for (const { entry, text } of pack.entries) {
    let chart;
    try { chart = parseOsu(text); } catch { continue; }
    const filenameVersion = /\[([^\]]*)\]\.osu$/i.exec(entry.path)?.[1]?.trim();
    const original = entry.version?.trim() || chart.meta.version || filenameVersion || '(無名)';
    if (chart.mode===2 || chart.mode===3 || !chart.targets.length && !chart.rolls.length) continue;
    let version = original;
    for (let n=2; seen.has(norm(version)); n++) version = `${original} (${n})`;
    seen.add(norm(version));
    chart.meta.version = version;
    const course = chart.stats.chords ? 'kasane' : (COURSE_ALIAS[norm(entry.course)] || guessCourse(chart));
    if (course==='kasane' || !chart.targets.length) continue;

    const seals = chart.targets.map((note,index) => {
      const id = index+':'+note.t+':'+note.color+(note.big?'B':'');
      const side = entry.noise?.[id]?.[0];
      return side==='left'||side==='right'?side:null;
    });
    const { level } = estimateKasaneDifficulty(chart, course, (_,i)=>[seals[i]]);
    charts.push({
      uid:pack.key+'::'+version, title:pack.title, path:pack.path, hash:pack.hash, course, level,
      length:chart.length, firstT:chart.firstT,
      targets:chart.targets.map(({t,type,color,big},i)=>({t,type,color,big,noise:seals[i]})),
      rolls:chart.rolls.map(({t,end,big,hits})=>({t,end,big,hits})),
    });
  }
}
process.stdout.write(JSON.stringify({format:1,charts}));
