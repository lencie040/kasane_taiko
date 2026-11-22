'use strict';

// Measurements use actual hit times so BPM changes and tuplets work the same in
// the editor and in the library. A large single is playable with one hand.
function measureChartDifficulty(chart) {
  const targets = chart.targets;
  if (!targets.length) {
    return { burst:0, sustained:0, pace:0, color:0, rhythm:0, chords:0, chordReading:0,
      speedChanges:0, lowScroll:0, highScroll:0, strikes:0 };
  }

  const sections = new Map();
  const firstTime = targets[0].t;
  const starts = [0, 0];
  const weights = [0, 0];
  const charges = [];
  const windows = [1000, 4000];
  const scrollRates = [];
  let previousMask = 0, priorGap = 0, run = 0, lastRun = 0;
  let strikes = 0, chordStrikes = 0, chordReading = 0, color = 0, rhythm = 0, speedChanges = 0;

  for (const [i, current] of targets.entries()) {
    const previous = targets[i - 1];
    const gap = previous ? current.t - previous.t : Infinity;
    const chord = current.type === 'chord';
    const notes = chord ? current.notes : [current];
    let mask = 0, hands = 0;
    for (const note of notes) {
      mask |= note.color === 'd' ? 1 : 2;
      hands += chord && note.big ? 2 : 1;
    }
    strikes += hands;
    const hurried = Math.max(0, Math.min(1, (420 - gap) / 300));
    if (chord) {
      chordStrikes += hands;
      chordReading += (notes.length - 1) * (.55 + .45 * hurried);
      if (previous?.type === 'chord' && previousMask !== mask) chordReading += .5 * hurried;
    }
    if (!previous || gap >= 420 || chord || previous.type === 'chord') {
      run = 1;
      lastRun = 0;
    } else if (previousMask === mask) {
      run++;
    } else {
      // A straight d-k-d-k run is easier to read than mixed groups of hits.
      color += (.55 + (run > 1 ? .55 : 0) + (lastRun && lastRun !== run ? .25 : 0)) * hurried;
      lastRun = run;
      run = 1;
    }
    if (previous && priorGap > 0 && gap < 430 && priorGap < 430 && Math.abs(gap - priorGap) > 3) {
      rhythm += Math.min(1, Math.abs(Math.log2(gap / priorGap))) * hurried;
    }
    if (previous && previous.speed > 0 && current.speed > 0) {
      speedChanges += Math.min(1, Math.abs(Math.log2(current.speed / previous.speed))) * hurried;
    }
    if (current.speed > 0) scrollRates.push(current.speed * 240000);
    previousMask = mask;
    priorGap = gap;

    // Simultaneity adds coordination cost without treating four simultaneous
    // strikes like four consecutive notes at the same timestamp.
    const charge = 1 + (hands - 1) * .48;
    charges.push(charge);
    const section = Math.floor((current.t - firstTime) / 1000);
    let peak = sections.get(section);
    if (!peak) {
      peak = [0, 0];
      sections.set(section, peak);
    }
    windows.forEach((duration, window) => {
      weights[window] += charge;
      while (current.t - targets[starts[window]].t >= duration) {
        weights[window] -= charges[starts[window]++];
      }
      peak[window] = Math.max(peak[window], weights[window] * 1000 / duration);
    });
  }

  const peaks = [...sections.values()];
  const bursts = peaks.map(peak => peak[0]).sort((a, b) => b - a);
  const stamina = peaks.map(peak => peak[1]).sort((a, b) => b - a);
  const count = Math.min(bursts.length, Math.max(3, Math.ceil(bursts.length * .12)));
  const burst = bursts.slice(0, count).reduce((a, b) => a + b, 0) / count;
  const sustained = stamina[Math.floor((stamina.length - 1) * .3)];
  const duration = Math.max(2000, targets.at(-1).t - firstTime + 400);
  scrollRates.sort((a, b) => a - b);
  const scrollAt = p => scrollRates[Math.floor((scrollRates.length - 1) * p)] || 0;
  return { burst, sustained, pace:charges.reduce((a, b) => a + b, 0) * 1000 / duration,
    color:color / targets.length, rhythm:rhythm / targets.length,
    chords:chordStrikes / strikes, chordReading:chordReading / targets.length,
    speedChanges:speedChanges / targets.length, lowScroll:scrollAt(.15), highScroll:scrollAt(.85), strikes };
}

function measureSealDifficulty(targets, sealAt) {
  if (!sealAt) return 0;
  let previous = [0, 0], chain = 0, hardest = 0, sealed = 0, previousTime = -Infinity;
  for (const [i, target] of targets.entries()) {
    const notes = target.type === 'chord' ? target.notes : [target];
    const seals = sealAt(target, i);
    const forced = [0, 0];
    if (Array.isArray(seals)) for (const [j, note] of notes.entries()) {
      const side = seals[j];
      if (side === 'left' || side === 'right') {
        // The sealed side is forbidden. Only the other hand can hit the note.
        forced[side === 'left' ? 1 : 0] |= note.color === 'd' ? 1 : 2;
        sealed++;
      }
    }
    const gap = target.t - previousTime;
    const rapid = Math.max(0, (320 - gap) / 320);
    let repeat = 0, simultaneous = 0;
    for (const hand of [0, 1]) {
      if (forced[hand] && previous[hand]) repeat += forced[hand] & previous[hand] ? 1.8 : .46;
      if (forced[hand] === 3) simultaneous += 1.15;
    }
    chain = forced.some(Boolean) ? chain * Math.exp(-gap / 210) + repeat * rapid + simultaneous : 0;
    hardest = Math.max(hardest, chain);
    previous = forced;
    previousTime = target.t;
  }
  return sealed ? 1.1 * sealed / targets.length + .9 * Math.log1p(hardest) : 0;
}

function estimateKasaneDifficulty(chart, course, sealAt) {
  const cached = chartDifficultyMeasurements.get(chart.targets);
  const f = cached || measureChartDifficulty(chart);
  if (!cached) chartDifficultyMeasurements.set(chart.targets, f);

  // The star scale is calibrated against former library ratings, grouped by
  // song in validation. Each term contributes positively to its own skill.
  const quantity = 2.86 * Math.log1p(f.burst) + 1.32 * Math.log1p(f.sustained)
    + .30 * Math.log1p(f.pace) + .30 * Math.log1p(f.strikes / 140);
  const technique = .55 * f.color;
  const rhythm = 1.15 * f.rhythm;
  const simultaneous = 1.05 * f.chords + .72 * f.chordReading;
  const base = -2.23 + quantity + technique + rhythm + simultaneous;
  const lowComfort = 62 + 4 * Math.max(1, base);
  const highComfort = 205 + 14 * Math.max(1, base);
  const outside = (value, bound, lower) => value > 0 ? Math.max(0, Math.log2(lower ? bound / value : value / bound)) : 0;
  const visibility = 1.5 * f.speedChanges
    + .48 * Math.min(2.5, outside(f.lowScroll, lowComfort, true))
    + .60 * Math.min(2.5, outside(f.highScroll, highComfort, false));
  const sealed = measureSealDifficulty(chart.targets, sealAt);

  const load = base + visibility + sealed;
  // Leave headroom for unusually dense charts without a long flat ceiling.
  const stars = load <= 11.7 ? load : 12.9 - 1.2 * Math.exp(-(load - 11.7) / 1.2);
  const level = course === 'kasane'
    ? Math.max(1, Math.min(10, Math.round(1 + (load - 4) * .83 + 2.1 * f.chords)))
    : Math.max(1, Math.round(stars * 10) / 10);
  return { level, burst:f.burst, quantity, technique, rhythm, visibility, simultaneous, sealed };
}

const chartDifficultyMeasurements = new WeakMap();
