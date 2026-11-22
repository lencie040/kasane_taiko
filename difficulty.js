'use strict';

function similarIntervals(a, b) {
  return Math.abs(a - b) <= Math.max(3, Math.min(a, b) * .055);
}

function rhythmChange(gap, previous, earlier) {
  const shortest = Math.min(gap, previous);
  const longest = Math.max(gap, previous);
  if (shortest <= 0 || longest > 850 || similarIntervals(gap, previous)) return 0;

  const change = Math.log2(longest / shortest);
  // Changes between binary subdivisions are more regular than changes like
  // 16ths to 24ths, even when the difference in timing is larger.
  const gridDistance = Math.abs(change - Math.round(change));
  const irregular = Math.max(0, (gridDistance - .08) / .42);
  const shift = .6 * Math.min(1, change) + .85 * irregular;
  const urgency = .35 + .65 * Math.max(0, Math.min(1, (380 - shortest) / 270));
  const predictable = earlier > 0 && similarIntervals(gap, earlier);
  return shift * urgency * (predictable ? .7 : 1);
}

// Measurements use actual hit times so BPM changes and tuplets work the same in
// the editor and in the library. A large single is playable with one hand.
function measureChartDifficulty(chart) {
  const targets = chart.targets;
  if (!targets.length) {
    return { burst:0, sustained:0, quickThree:0, quickFive:0, pace:0, color:0, rhythm:0,
      peakColor:0, peakRhythm:0, chords:0, chordReading:0,
      speedChanges:0, lowScroll:0, highScroll:0, strikes:0 };
  }

  const sections = new Map();
  const firstTime = targets[0].t;
  const starts = [0, 0];
  const weights = [0, 0];
  const charges = [];
  const windows = [1000, 4000];
  const scrollRates = [];
  const lastColorRuns = [0, 0, 0];
  let previousMask = 0, priorGap = 0, earlierGap = 0, run = 0, lastRun = 0;
  let strikes = 0, chordStrikes = 0, chordReading = 0, color = 0, rhythm = 0, speedChanges = 0;
  let exposure = 0, recentColor = 0, recentRhythm = 0, peakColor = 0, peakRhythm = 0;
  let quickThree = 0, quickFive = 0;

  for (const [i, current] of targets.entries()) {
    const previous = targets[i - 1];
    const gap = previous ? current.t - previous.t : Infinity;
    if (i >= 2) quickThree = Math.max(quickThree, 2000 / (current.t - targets[i - 2].t));
    if (i >= 4) quickFive = Math.max(quickFive, 4000 / (current.t - targets[i - 4].t));
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
    let colorCost = 0;
    if (!previous || gap >= 500 || chord || previous.type === 'chord') {
      run = 1;
      lastRun = 0;
      lastColorRuns.fill(0);
    } else if (previousMask === mask) {
      run++;
    } else {
      // Weigh variation in the lengths of d/k groups, including cases where
      // a color returns with a different length than its last appearance.
      const changedLength = lastColorRuns[previousMask] && lastColorRuns[previousMask] !== run;
      colorCost = (.28 + (run > 1 ? .35 : 0) + (lastRun && lastRun !== run ? .3 : 0)
        + (changedLength ? .45 : 0)) * (.18 + .82 * hurried);
      lastColorRuns[previousMask] = run;
      lastRun = run;
      run = 1;
    }
    const rhythmCost = rhythmChange(gap, priorGap, earlierGap);
    color += colorCost;
    rhythm += rhythmCost;
    // A short technical passage can determine the difficulty of a whole
    // chart. Average recent effort per note so density doesn't count twice.
    const decay = Math.exp(-gap / 900);
    exposure = exposure * decay + 1;
    recentColor = recentColor * decay + colorCost;
    recentRhythm = recentRhythm * decay + rhythmCost;
    const sample = Math.max(4, exposure);
    peakColor = Math.max(peakColor, recentColor / sample);
    peakRhythm = Math.max(peakRhythm, recentRhythm / sample);
    if (previous && previous.speed > 0 && current.speed > 0) {
      speedChanges += Math.min(1, Math.abs(Math.log2(current.speed / previous.speed))) * hurried;
    }
    if (current.speed > 0) scrollRates.push(current.speed * 240000);
    previousMask = mask;
    earlierGap = priorGap;
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
  return { burst, sustained, quickThree, quickFive, pace:charges.reduce((a, b) => a + b, 0) * 1000 / duration,
    color:color / targets.length, rhythm:rhythm / targets.length, peakColor, peakRhythm,
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

  // Weigh a fast group of a few hits when it is much quicker than the
  // surrounding one-second runs. Regular density still contributes separately.
  const shortSpeed = .62 * f.quickThree + .38 * f.quickFive;
  const usualSpeed = Math.max(7, 1.22 * f.burst);
  const shortBurst = Math.min(2.2, 2.8 * Math.log(Math.max(1, shortSpeed / usualSpeed)));
  const effectiveBurst = f.burst - .45 * Math.max(0, f.burst - 12);
  const effectiveSustained = f.sustained - .50 * Math.max(0, f.sustained - 7);
  const quantity = 2.45 * Math.log1p(effectiveBurst) + 1.30 * Math.log1p(effectiveSustained)
    + .27 * Math.log1p(f.pace) + .25 * Math.log1p(f.strikes / 140) + shortBurst;
  const patternWeight = .70 + .30 * Math.min(1, f.burst / 13);
  const technique = patternWeight * (1.35 * f.color + 1.35 * f.peakColor);
  const rhythm = patternWeight * (1.50 * f.rhythm + 1.35 * f.peakRhythm);
  const simultaneous = 1.05 * f.chords + .72 * f.chordReading;
  const base = -2.22 + quantity + technique + rhythm + simultaneous;
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
