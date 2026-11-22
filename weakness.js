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
  if (sealsAt(target, index)?.some(side => side === 'left' || side === 'right')) return 'seal';
  if (target.type === 'chord' || (previous?.type === 'chord' && before <= 320)
    || (next?.type === 'chord' && after <= 320)) return 'chord';
  if (before < 420 && after < 420 && Math.min(before, after) / Math.max(before, after) < .77) return 'rhythm';
  if ((before <= 310 && previous?.type === 'single' && target.color !== previous.color)
    || (after <= 310 && next?.type === 'single' && target.color !== next.color)) return 'colors';
  return Math.max(before, after) <= 180 ? 'stream' : 'timing';
}

function weaknessNoteKey(target, seals) {
  const noteKey = (note, index) => {
    const side = seals?.[index];
    return note.color + (note.big ? 'B' : '') + (side === 'left' ? 'L' : side === 'right' ? 'R' : '');
  };
  return target.type === 'chord' ? target.notes.map(noteKey).join('+') : noteKey(target, 0);
}

function weaknessRolls(chart, start, end) {
  return chart.rolls.filter(r => r.t <= end && r.end >= start).map(r => ({
    kind:r.type, big:!!r.big, hits:r.hits,
    start:r.t - start, end:r.end - start,
  }));
}

function makeWeaknessPhrase(chart, targets, left, right, sealsAt) {
  const notes = targets.slice(left, right + 1);
  const start = notes[0].t, end = notes.at(-1).t;
  return {
    keys:notes.map((target, i) => weaknessNoteKey(target, sealsAt(target, left + i))),
    gaps:notes.slice(1).map((target, i) => target.t - notes[i].t),
    span:end - start,
    rolls:weaknessRolls(chart, start, end),
  };
}

function weaknessPhrase(chart, targets, first, last, sealsAt) {
  const firstTime = targets[first].t, lastTime = targets[last].t;
  let left = first, right = last;
  // Keep every missed note, with enough of its entry and exit to distinguish
  // the whole phrase from an incidental three-note match.
  while (left > 0 && first - left < 2 && targets[left - 1].t >= firstTime - 700) left--;
  while (right + 1 < targets.length && right - last < 2 && targets[right + 1].t <= lastTime + 700) right++;
  while (right - left + 1 < 5) {
    const before = left > 0 ? firstTime - targets[left - 1].t : Infinity;
    const after = right + 1 < targets.length ? targets[right + 1].t - lastTime : Infinity;
    if (Math.min(before, after) > 950) break;
    if (before <= after) left--;
    else right++;
  }
  if (right - left + 1 < 4) return null;
  return makeWeaknessPhrase(chart, targets, left, right, sealsAt);
}

function weaknessCorePhrases(chart, targets, anchors, sealsAt) {
  const cores = new Map();
  // Sample misses throughout the cluster. Each fragment retains the miss and
  // its entry and exit where they exist, even when the whole cluster is unique.
  const centers = [anchors[0], anchors[Math.floor(anchors.length / 2)], anchors.at(-1)];
  for (const anchor of new Set(centers)) {
    for (const [offset, count] of [[-2, 4], [-1, 4], [-1, 3]]) {
      const left = Math.max(0, Math.min(anchor + offset, targets.length - count));
      const right = left + count - 1;
      const key = left + ':' + count;
      if (!targets[right] || targets[anchor].t - targets[left].t > 1150
        || targets[right].t - targets[anchor].t > 1150 || cores.has(key)) continue;
      cores.set(key, makeWeaknessPhrase(chart, targets, left, right, sealsAt));
    }
  }
  return [...cores.values()];
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
  const cluster = misses.slice(first, last + 1).map(({index}) => ({index, kind:weaknessPattern(targets, index, sealsAt)}));
  const pattern = cluster.reduce((best, item) => priorities.indexOf(item.kind) < priorities.indexOf(best) ? item.kind : best, cluster[0].kind);
  const anchors = cluster.filter(item => item.kind === pattern).map(item => item.index);
  const phrase = weaknessPhrase(chart, targets, misses[first].index, misses[last].index, sealsAt);
  const cores = weaknessCorePhrases(chart, targets, anchors, sealsAt);
  return { ...range, pattern, phrase, cores, kind, before:weaknessJudgments(targets, range.focusFrom, range.to) };
}

function weaknessGapDirection(before, after) {
  const ratio = after / before;
  return ratio > 1.24 ? 1 : ratio < 1 / 1.24 ? -1 : 0;
}

function weaknessPhraseDistance(phrase, chart, index) {
  const targets = chart.targets;
  const start = targets[index].t, end = targets[index + phrase.keys.length - 1].t;
  const scale = (end - start) / phrase.span;
  if (!(scale >= .72 && scale <= 1.4)) return Infinity;
  let error = 0, previous = 0;
  for (const [i, gap] of phrase.gaps.entries()) {
    const actual = targets[index + i + 1].t - targets[index + i].t;
    const expected = gap * scale;
    const delta = Math.abs(actual - expected);
    const tolerance = 5 + expected * .105;
    if (delta > tolerance) return Infinity;
    if (i > 0 && weaknessGapDirection(phrase.gaps[i - 1], gap) !== weaknessGapDirection(previous, actual)) return Infinity;
    error += delta / tolerance;
    previous = actual;
  }
  const rolls = weaknessRolls(chart, start, end);
  if (rolls.length !== phrase.rolls.length || rolls.some((r, i) => {
    const expected = phrase.rolls[i];
    return r.kind !== expected.kind || r.big !== expected.big || r.hits !== expected.hits
      || Math.abs(r.start - expected.start * scale) > 20 || Math.abs(r.end - expected.end * scale) > 20;
  })) return Infinity;
  return error / phrase.gaps.length + Math.abs(Math.log2(scale));
}

function relatedWeaknessExercises(origin, exercise, charts, sealsFor) {
  const phrases = [exercise?.phrase, ...(exercise?.cores ?? [])].filter(Boolean).map(phrase => ({
    phrase, penalty:phrase === exercise.phrase ? 0 : phrase.keys.length >= 4 ? .65 : 1.2,
    mirrored:phrase.keys.some(key => /[+LR]/.test(key)) ? null : phrase.keys.map(key => key.replace(/[dk]/g, color => color === 'd' ? 'k' : 'd')),
  }));
  if (!phrases.length) return [];
  const songs = new Map();
  for (const chart of charts) {
    if (chart.set.key === origin.set.key || chart.set.demo || chart.targets.length < 3) continue;
    const readSeal = sealsFor(chart);
    const keys = chart.targets.map((target, index) => weaknessNoteKey(target, readSeal(target, index)));
    let best = null;
    for (const {phrase,penalty,mirrored} of phrases) {
      const size = phrase.keys.length;
      if (best && best.distance <= penalty) continue;
      for (let index = 0; index <= keys.length - size; index++) {
        const flipped = mirrored && mirrored[0] === keys[index];
        const reference = flipped ? mirrored : phrase.keys;
        if (keys[index] !== reference[0] || !reference.every((key, i) => key === keys[index + i])) continue;
        const distance = weaknessPhraseDistance(phrase, chart, index) + penalty + (flipped ? .32 : 0);
        if (!Number.isFinite(distance) || (best && distance >= best.distance)) continue;
        const from = chart.targets[index].t, to = chart.targets[index + size - 1].t;
        best = { chart, from, to, focusFrom:from, distance, mirrored:!!flipped };
      }
    }
    const song = songs.get(chart.set.key);
    if (best && (!song || best.distance < song.distance)) songs.set(chart.set.key, best);
  }
  return [...songs.values()].sort((a, b) => a.distance - b.distance).slice(0, 4);
}

function compareWeaknessResults(before, after) {
  return Math.sign(before.bad - after.bad || before.ok - after.ok);
}
