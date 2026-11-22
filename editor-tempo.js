'use strict';

// Compare the periodicity of changes in low-band and broadband energy.
function estimateKasaneTempo(samples, sampleRate) {
  const hop = Math.round(sampleRate / 200);
  const frames = Math.floor(Math.min(samples.length, sampleRate * 120) / hop);
  if (frames < 800) return null;
  const flux = new Float32Array(frames);
  const stride = Math.max(1, Math.floor(sampleRate / 11025));
  const filter = 1 - Math.exp(-2 * Math.PI * 170 * stride / sampleRate);
  let low = 0, lastLow = 0, lastFull = 0;
  for (let frame = 0; frame < frames; frame++) {
    let bass = 0, full = 0, count = 0;
    for (let i = frame * hop; i < (frame + 1) * hop; i += stride) {
      const sample = samples[i];
      low += (sample - low) * filter;
      bass += low * low;
      full += sample * sample;
      count++;
    }
    bass = Math.log1p(25 * Math.sqrt(bass / count));
    full = Math.log1p(25 * Math.sqrt(full / count));
    flux[frame] = Math.max(0, bass - lastLow) + .65 * Math.max(0, full - lastFull);
    lastLow = bass;
    lastFull = full;
  }
  const mean = flux.reduce((a, b) => a + b, 0) / frames;
  const onset = Float32Array.from(flux, v => Math.max(0, v - mean * 1.15));
  const energy = onset.reduce((a, b) => a + b * b, 0);
  if (energy < .001) return null;
  const hz = sampleRate / hop;
  const minLag = Math.floor(hz * 60 / 245), maxLag = Math.ceil(hz * 60 / 58);
  const correlations = new Float32Array(maxLag * 3 + 4);
  for (let lag = minLag; lag < correlations.length; lag++) {
    let value = 0;
    for (let i = lag; i < frames; i++) value += onset[i] * onset[i - lag];
    correlations[lag] = value / energy;
  }
  let bestLag = minLag, best = -Infinity;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const peak = correlations[lag];
    if (peak < correlations[lag - 1] || peak < correlations[lag + 1]) continue;
    const harmonic = Math.max(correlations[lag * 2 - 1], correlations[lag * 2], correlations[lag * 2 + 1]);
    const score = (peak + .3 * harmonic) * (1 - .13 * Math.abs(Math.log2(60 * hz / lag / 135)));
    if (score > best) { best = score; bestLag = lag; }
  }
  const left = correlations[bestLag - 1], center = correlations[bestLag], right = correlations[bestLag + 1];
  if (center < .09) return null;
  const curve = left - 2 * center + right;
  const lag = bestLag + (curve < 0 ? .5 * (left - right) / curve : 0);
  const round = Math.round(60 * hz / lag * 100) / 100;
  // Refine the lag against the phase agreement of the strongest onsets.
  const peaks = [];
  for (let i = 1; i < frames - 1; i++) {
    if (onset[i] >= onset[i - 1] && onset[i] > onset[i + 1] && onset[i] > mean * 1.5) peaks.push(i);
  }
  const phase = bpm => {
    const w = 2 * Math.PI * bpm / 60 / hz;
    let x = 0, y = 0, total = 0;
    for (const i of peaks) {
      x += Math.cos(i * w) * onset[i];
      y += Math.sin(i * w) * onset[i];
      total += onset[i];
    }
    return { x, y, strength: Math.hypot(x, y) / Math.max(.001, total) };
  };
  let bpm = round, fit = phase(round);
  for (let i = -36; i <= 36; i++) {
    const candidate = Math.round((round + i * .025) * 1000) / 1000;
    const match = phase(candidate);
    if (match.strength > fit.strength) { bpm = candidate; fit = match; }
  }
  bpm = Math.round(bpm * 100) / 100;
  const beat = 60000 / bpm;
  const angle = Math.atan2(fit.y, fit.x);
  const offset = Math.round(((beat * angle / (2 * Math.PI) + beat) % beat));
  return { bpm, offset, confidence: Math.min(1, center * .5 + fit.strength * .5) };
}

if (typeof document === 'undefined') {
  self.onmessage = ({ data: { samples, sampleRate } }) => {
    try { self.postMessage({ result: estimateKasaneTempo(samples, sampleRate) }); }
    catch (error) { self.postMessage({ error: error.message }); }
  };
}
