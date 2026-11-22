'use strict';

function similarIntervals(a, b) {
  return Math.abs(a - b) <= Math.max(3, Math.min(a, b) * .055);
}

function rhythmSubdivision(gap, beat) {
  if (!(beat > 0 && gap > 0 && gap <= 850)) return null;
  // 48 ticks per beat represent common binary and ternary subdivisions.
  const ticks = Math.round(gap * 48 / beat);
  if (!ticks || !similarIntervals(gap, ticks * beat / 48)) return null;
  if (ticks % 12 === 0) return 'standard';
  if (ticks % 3 === 0) return 'binary';
  return ticks % 2 === 0 ? 'ternary' : null;
}

function rhythmChange(gap, previous, earlier, subdivision, previousSubdivision) {
  const shortest = Math.min(gap, previous);
  const longest = Math.max(gap, previous);
  if (shortest <= 0 || longest > 850 || similarIntervals(gap, previous)) return 0;

  const change = Math.log2(longest / shortest);
  // Changes between binary subdivisions are more regular than changes like
  // 16ths to 24ths, even when the difference in timing is larger.
  const gridDistance = Math.abs(change - Math.round(change));
  const irregular = Math.max(0, (gridDistance - .08) / .42);
  let shift = .6 * Math.min(1, change) + .85 * irregular;
  if (subdivision === 'standard' && previousSubdivision === 'standard') {
    // Common 8th/16th patterns on the same grid need less timing adjustment.
    const fast = Math.max(0, Math.min(1, (118 - shortest) / 65));
    shift *= .24 + .5 * fast + .64 * irregular;
  } else if (subdivision && previousSubdivision && subdivision !== previousSubdivision
    && (subdivision === 'ternary' || previousSubdivision === 'ternary')) {
    shift += .4 + .15 * (subdivision === 'binary' || previousSubdivision === 'binary');
  }
  const urgency = .35 + .65 * Math.max(0, Math.min(1, (380 - shortest) / 270));
  const predictable = earlier > 0 && similarIntervals(gap, earlier);
  return shift * urgency * (predictable ? .7 : 1);
}

// Measurements use actual hit times so BPM changes and tuplets work the same in
// the editor and in the library. A large single is playable with one hand.
function measureChartDifficulty(chart) {
  const targets = chart.targets;
  if (!targets.length) {
    return { burst:0, sustained:0, fastRunRate:0, quickThree:0, quickFive:0, pace:0, recovery:0, fastHitPressure:0, color:0, rhythm:0,
      peakColor:0, peakRhythm:0, peakGridMix:0, offbeatEntries:0, chords:0, chordReading:0,
      speedChanges:0, lowScroll:0, highScroll:0, strikes:0 };
  }

  const sections = new Map();
  const firstTime = targets[0].t;
  const windows = [1000, 1600, 2400, 4000].map(duration => ({ duration, start:0, weight:0 }));
  const [burstWindow, shortStream, longStream, sustainedWindow] = windows;
  const charges = [];
  const scrollRates = [];
  const timing = chart.segs ?? [];
  const lastColorRuns = [0, 0, 0];
  let previousMask = 0, priorGap = 0, earlierGap = 0, run = 0, lastRun = 0;
  let timingIndex = 0, previousBeat = 0, previousSubdivision = null, previousOffbeat = false;
  let strikes = 0, chordStrikes = 0, chordReading = 0, color = 0, rhythm = 0, speedChanges = 0;
  let exposure = 0, recentColor = 0, recentRhythm = 0, peakColor = 0, peakRhythm = 0;
  let offbeatEntries = 0, recentBinary = 0, recentTernary = 0, peakGridMix = 0;
  let quickThree = 0, quickFive = 0, fastRunRate = 0, recoveryMs = 0, fastHitPressure = 0;

  for (const [i, current] of targets.entries()) {
    const previous = targets[i - 1];
    const gap = previous ? current.t - previous.t : Infinity;
    if (previous) {
      recoveryMs += Math.max(0, gap - 160);
      fastHitPressure += Math.max(0, Math.min(32, 1000 / gap) - 16);
    }
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
      const transitionSpeed = .14 + .86 * Math.max(0, Math.min(1, (195 - gap) / 130));
      colorCost = (.28 + (run > 1 ? .35 : 0) + (lastRun && lastRun !== run ? .3 : 0)
        + (changedLength ? .45 : 0)) * transitionSpeed;
      lastColorRuns[previousMask] = run;
      lastRun = run;
      run = 1;
    }
    while (timing[timingIndex + 1]?.time <= current.t + 1) timingIndex++;
    const segment = timing[timingIndex];
    const beat = segment?.bl ?? 0;
    const subdivision = beat === previousBeat ? rhythmSubdivision(gap, beat) : null;
    const rhythmCost = rhythmChange(gap, priorGap, earlierGap, subdivision, previousSubdivision);
    const halfBeats = beat > 0 ? (current.t - segment.rt) * 2 / beat : 0;
    const offbeat = Math.abs(halfBeats - Math.round(halfBeats)) >= .42;
    if (subdivision === 'standard' && offbeat && !previousOffbeat && gap >= beat * .375 && gap <= beat * 1.5) {
      offbeatEntries++;
    }
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
    // Mixing binary and ternary subdivisions within a phrase remains hard
    // when ordinary notes separate their fastest groups.
    recentBinary = recentBinary * decay + (subdivision === 'binary' ? 1 : 0);
    recentTernary = recentTernary * decay + (subdivision === 'ternary' ? 1 : 0);
    peakGridMix = Math.max(peakGridMix, Math.min(recentBinary, recentTernary) / Math.max(5, exposure));
    if (previous && previous.speed > 0 && current.speed > 0) {
      speedChanges += Math.min(1, Math.abs(Math.log2(current.speed / previous.speed))) * hurried;
    }
    if (current.speed > 0) scrollRates.push(current.speed * 240000);
    previousMask = mask;
    earlierGap = priorGap;
    priorGap = gap;
    previousBeat = beat;
    previousSubdivision = subdivision;
    previousOffbeat = offbeat;

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
    for (const window of windows) {
      window.weight += charge;
      while (current.t - targets[window.start].t >= window.duration) {
        window.weight -= charges[window.start++];
      }
    }
    peak[0] = Math.max(peak[0], burstWindow.weight);
    peak[1] = Math.max(peak[1], sustainedWindow.weight / 4);
    // Count sequential targets here and account for stacked strikes in the
    // separate chord factors.
    const streamRate = 1000 * (.35 * (i - shortStream.start + 1) / shortStream.duration
      + .65 * (i - longStream.start + 1) / longStream.duration);
    fastRunRate = Math.max(fastRunRate, streamRate);
  }

  const peaks = [...sections.values()];
  const bursts = peaks.map(peak => peak[0]).sort((a, b) => b - a);
  const stamina = peaks.map(peak => peak[1]).sort((a, b) => b - a);
  const count = Math.min(bursts.length, Math.max(3, Math.ceil(bursts.length * .12)));
  const burst = bursts.slice(0, count).reduce((a, b) => a + b, 0) / count;
  const sustained = stamina[Math.floor((stamina.length - 1) * .3)];
  const span = targets.at(-1).t - firstTime;
  const duration = Math.max(2000, span + 400);
  scrollRates.sort((a, b) => a - b);
  const scrollAt = p => scrollRates[Math.floor((scrollRates.length - 1) * p)] || 0;
  return { burst, sustained, fastRunRate, quickThree, quickFive, pace:charges.reduce((a, b) => a + b, 0) * 1000 / duration,
    color:color / targets.length, rhythm:rhythm / targets.length, peakColor, peakRhythm, peakGridMix,
    offbeatEntries:offbeatEntries / targets.length,
    chords:chordStrikes / strikes, chordReading:chordReading / targets.length,
    speedChanges:speedChanges / targets.length, lowScroll:scrollAt(.15), highScroll:scrollAt(.85), strikes,
    recovery:recoveryMs / Math.max(1, span), fastHitPressure:fastHitPressure / Math.max(1, targets.length - 1) };
}

function chartRadarVolume(measurements) {
  const { sustained, fastRunRate, pace, recovery, fastHitPressure, strikes } = measurements;
  const sustainedPace = .48 * sustained + .32 * fastRunRate + .20 * pace;
  const effectivePace = (sustainedPace + .24 * fastHitPressure) * (1 - .45 * recovery);
  // Keep room above ordinary densities for changes between fast hit intervals.
  const steadyScore = Math.min(1, effectivePace / 14);
  const speedScore = Math.min(1, Math.max(0, effectivePace - 14) / 12);
  const paceScore = .68 * steadyScore + .32 * speedScore;
  const countScore = 1 - 2 ** (-strikes / 100);
  return .90 * paceScore + .10 * countScore;
}

// The expected one-hand pace rises with the chart's baseline skill level.
// Use a transition band so adjacent BPMs never create a hard rating jump.
function alternatingHandLoad(targets, baseline) {
  const skill = Math.max(0, Math.min(1, (baseline - 1) / 11));
  const transitionStart = 141 - 31 * skill;
  let repeats = 0, recentNotes = 0, recentCost = 0, peakCost = 0;
  let totalCost = 0, totalFastCost = 0;
  for (let i = 1; i < targets.length; i++) {
    const previous = targets[i - 1], current = targets[i];
    const gap = current.t - previous.t;
    const repeated = previous.type === 'single' && current.type === 'single' && previous.color === current.color;
    const progress = repeated ? Math.max(0, Math.min(1, (transitionStart - gap) / 16)) : 0;
    const demand = progress * progress * (3 - 2 * progress);
    // Count consecutive repeats so a faster run cannot lose weight because
    // the same number of hits takes less time. Each extra hit adds less load.
    repeats = demand > 0 ? repeats + demand : 0;
    const lengthLoad = -Math.expm1(-repeats / 4);
    const cost = demand * lengthLoad;
    totalCost += cost;
    // Faster than about 14 hits per second, maintaining alternating strokes
    // requires more control. One isolated rush should still weigh less.
    const speedLoad = 2 * Math.max(0, 72 - gap) / Math.max(36, gap);
    totalFastCost += cost * speedLoad;
    const decay = Math.exp(-gap / 650);
    recentNotes = recentNotes * decay + 1;
    recentCost = recentCost * decay + cost;
    peakCost = Math.max(peakCost, recentCost / Math.max(5, recentNotes));
  }
  const intervals = Math.max(1, targets.length - 1);
  const fastRepeats = totalFastCost / intervals;
  const recurringSpeed = fastRepeats * Math.min(1, fastRepeats / .12);
  return .72 * totalCost / intervals + .40 * peakCost + .95 * Math.log1p(5 * recurringSpeed);
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
  const usualSpeed = Math.max(7, 1.22 * f.burst);
  const nearbySpeed = f.quickFive || f.quickThree;
  // An isolated triplet carries less weight than one inside a fast passage.
  const support = Math.max(.12 * nearbySpeed, 1.25 * (nearbySpeed - usualSpeed), .9 * (nearbySpeed - 10));
  const shortSpeed = Math.min(.62 * f.quickThree + .38 * nearbySpeed, nearbySpeed + support);
  const shortBurst = Math.min(2.2, 2.8 * Math.log(Math.max(1, shortSpeed / usualSpeed)));
  const effectiveBurst = f.burst - .45 * Math.max(0, f.burst - 12);
  const effectiveSustained = f.sustained - .50 * Math.max(0, f.sustained - 7);
  const runLoad = -.32 * Math.expm1(-Math.max(0, f.fastRunRate - 8) / 2);
  const enduranceLoad = runLoad + .27 * Math.max(0, f.fastRunRate - 17) + .09 * Math.max(0, f.sustained - 12);
  const endurance = 1.55 * Math.tanh(enduranceLoad / 1.55);
  // Apply recovery where high density persists beyond the fastest window.
  // A short, isolated peak retains its own difficulty.
  const fastRun = Math.max(0, Math.min(1, (f.fastRunRate - 10) / 4));
  const continuity = Math.min(1, f.sustained / Math.max(1, .56 * f.fastRunRate));
  const sustainedShare = Math.max(.18 * Math.min(1, f.sustained / 6), fastRun * continuity ** 2);
  const recoveryDiscount = Math.min(.55, 1.05 * f.recovery * sustainedShare);
  const sustainedWork = (1.30 * Math.log1p(effectiveSustained) + endurance) * (1 - recoveryDiscount);
  const highSpeedWork = .50 * Math.log1p(f.fastHitPressure / 2.4) * (1 - f.recovery);
  const quantity = 2.45 * Math.log1p(effectiveBurst) + .27 * Math.log1p(f.pace)
    + .25 * Math.log1p(f.strikes / 140) + shortBurst + sustainedWork + highSpeedWork;
  const patternWeight = .70 + .30 * Math.min(1, f.burst / 13);
  const colorTechnique = patternWeight * (1.35 * f.color + 1.35 * f.peakColor);
  const syncopation = .95 * Math.tanh(19.5 * Math.max(0, f.offbeatEntries - .025));
  const rhythm = patternWeight * (1.50 * f.rhythm + 1.35 * f.peakRhythm + 1.85 * f.peakGridMix + syncopation);
  const simultaneous = 1.05 * f.chords + .72 * f.chordReading;
  const base = -2.22 + quantity + colorTechnique + rhythm + simultaneous;
  const lowComfort = 62 + 4 * Math.max(1, base);
  const highComfort = 205 + 14 * Math.max(1, base);
  const outside = (value, bound, lower) => value > 0 ? Math.max(0, Math.log2(lower ? bound / value : value / bound)) : 0;
  const visibility = 1.5 * f.speedChanges
    + .48 * Math.min(2.5, outside(f.lowScroll, lowComfort, true))
    + .60 * Math.min(2.5, outside(f.highScroll, highComfort, false));
  const sealed = measureSealDifficulty(chart.targets, sealAt);

  const baseline = base + visibility + sealed;
  const alternation = alternatingHandLoad(chart.targets, baseline) * (1 - Math.min(.78, 1.45 * f.recovery));
  const technique = colorTechnique + alternation;
  const load = baseline + alternation;
  // Leave headroom for unusually dense charts without a long flat ceiling.
  const stars = load <= 11.7 ? load : 12.9 - 1.2 * Math.exp(-(load - 11.7) / 1.2);
  const level = course === 'kasane'
    ? Math.max(1, Math.min(10, Math.round(1 + (load - 4) * .83 + 2.1 * f.chords)))
    : Math.max(1, Math.round(stars * 10) / 10);
  return { level, burst:f.burst, quantity, technique, rhythm, visibility, simultaneous, sealed, radarVolume:chartRadarVolume(f) };
}

const chartDifficultyMeasurements = new WeakMap();
