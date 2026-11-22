'use strict';

const WEAKNESS_PATTERNS = {
  seal:'封印ノーツ',
  chord:'同時押し',
  rhythm:'音符間隔の切り替え',
  colors:'ドン・カッの複合',
  stream:'速い連続ノーツ',
  timing:'打点のタイミング',
};

function weaknessJudgments(targets, from, to) {
  const counts = { bad:0, ok:0 };
  for (const target of targets) {
    if (target.t >= from && target.t <= to && (target.res === 'bad' || target.res === 'ok')) {
      counts[target.res] += target.type === 'chord' ? target.notes.length : 1;
    }
  }
  return counts;
}

function weaknessMeasure(chart, time) {
  const segment = segAt(chart.segs, time);
  const length = segment?.bl * segment?.meter;
  if (!(length > 0)) return { start:time - 600, end:time + 750 };
  const start = segment.rt + Math.floor((time - segment.rt + 1) / length) * length;
  return { start, end:start + length };
}

function weaknessRange(chart, first, last) {
  const bar = weaknessMeasure(chart, first);
  const focusFrom = Math.max(first - 850, Math.min(first, bar.start));
  const to = Math.min(chart.length, Math.max(last, Math.min(last + 900, weaknessMeasure(chart, last).end - 1)));
  const previous = weaknessMeasure(chart, bar.start - 2);
  return { from:Math.max(0, focusFrom - 4500, Math.min(focusFrom, previous.start)), to, focusFrom };
}

function weaknessPattern(targets, index, sealsAt) {
  const target = targets[index], previous = targets[index - 1], next = targets[index + 1];
  const before = previous ? Math.min(500, target.t - previous.t) : 500;
  const after = next ? Math.min(500, next.t - target.t) : 500;
  const seal = sealsAt(target, index);
  const side = seal?.find(value => value === 'left' || value === 'right');
  const sameHand = side && (
    (before < 260 && sealsAt(previous, index - 1)?.includes(side))
    || (after < 260 && sealsAt(next, index + 1)?.includes(side))
  );
  const chordOffset = target.type === 'chord' ? 0
    : previous?.type === 'chord' && before <= 320 ? -1
    : next?.type === 'chord' && after <= 320 ? 1 : null;
  const chord = chordOffset === null ? null : targets[index + chordOffset];
  const changeBefore = before <= 310 && previous?.type === 'single' && target.color !== previous.color;
  const changeAfter = after <= 310 && next?.type === 'single' && target.color !== next.color;
  let kind = 'timing';
  if (side) kind = 'seal';
  else if (chord) kind = 'chord';
  else if (before < 420 && after < 420 && Math.min(before, after) / Math.max(before, after) < .77) kind = 'rhythm';
  else if (changeBefore || changeAfter) kind = 'colors';
  else if (Math.max(before, after) <= 180) kind = 'stream';
  return { kind, before, after, side, sameHand:!!sameHand, chordOffset, chordSize:chord?.notes.length ?? 0,
    changes:Number(changeBefore) + Number(changeAfter) };
}

function detectWeakness(chart, targets, stats) {
  if (!stats.bad && !stats.ok) return null;
  const kind = stats.bad ? 'bad' : 'ok';
  const misses = targets.map((target, index) => ({target, index})).filter(({target}) => target.res === kind);
  if (!misses.length) return null;

  // Select the cluster with the most missed notes in a short passage.
  const weight = ({target}) => target.type === 'chord' ? target.notes.length : 1;
  let left = 0, count = 0, bestCount = 0, first = 0, last = 0;
  for (const [right, miss] of misses.entries()) {
    count += weight(miss);
    while (miss.target.t - misses[left].target.t > 1700) count -= weight(misses[left++]);
    if (count > bestCount) {
      first = left;
      last = right;
      bestCount = count;
    }
  }
  const range = weaknessRange(chart, misses[first].target.t, misses[last].target.t);
  const sealsAt = target => target.type === 'chord' ? target.notes.map(note => note.noise) : [target.noise];
  const priorities = Object.keys(WEAKNESS_PATTERNS);
  const patterns = misses.slice(first, last + 1).map(({index}) => weaknessPattern(targets, index, sealsAt));
  const pattern = patterns.reduce((best, next) => priorities.indexOf(next.kind) < priorities.indexOf(best.kind) ? next : best);
  return { ...range, pattern, kind, before:weaknessJudgments(targets, range.focusFrom, range.to) };
}

function weaknessPatternDistance(pattern, other) {
  const gap = (a, b) => Math.abs(Math.log2(Math.max(12, a) / Math.max(12, b)));
  return gap(pattern.before, other.before) + gap(pattern.after, other.after)
    + .35 * Math.abs(pattern.changes - other.changes)
    + .5 * Math.abs(pattern.chordSize - other.chordSize)
    + .7 * Number(pattern.chordOffset !== other.chordOffset)
    + .8 * Number(pattern.sameHand !== other.sameHand)
    + .3 * Number(pattern.side !== other.side);
}

function relatedWeaknessExercises(origin, pattern, charts, sealsFor) {
  const songs = new Map();
  for (const chart of charts) {
    if (chart.set.key === origin.set.key) continue;
    const readSeal = sealsFor(chart);
    let best = null;
    for (const [index, target] of chart.targets.entries()) {
      const sample = weaknessPattern(chart.targets, index, readSeal);
      if (sample.kind !== pattern.kind) continue;
      const distance = weaknessPatternDistance(pattern, sample);
      if (distance > 2.25 || (best && distance >= best.distance)) continue;
      best = { chart, t:target.t, distance };
    }
    const song = songs.get(chart.set.key);
    if (best && (!song || best.distance < song.distance)) songs.set(chart.set.key, best);
  }
  return [...songs.values()].sort((a, b) => a.distance - b.distance).slice(0, 2).map(({chart,t}) => ({
    chart, ...weaknessRange(chart, t, t),
  }));
}

function compareWeaknessResults(before, after) {
  return Math.sign(before.bad - after.bad || before.ok - after.ok);
}
