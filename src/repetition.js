// Repetition proxy, on-device and from the sound alone (replaces the SpeechRecognition idea).
// A sound or syllable repetition ("b-b-b-ball") shows up as short bursts in quick succession
// that have the same spectral shape as the start of the word that finally comes out.
// Like the block proxy, every hit is a candidate for the user to confirm, never a score.

import { sessionThreshold } from './summary.js';

export const REPETITION_DEFAULTS = {
  minGapSec: 0.03, // silence at least this long separates two bursts
  minUnitSec: 0.03, // shorter bursts are clicks
  maxRepeatSec: 0.35, // a repeated burst is short; only the final word may be long
  maxGapSec: 1.0, // bursts further apart than this are separate attempts
  loneRepeatMaxSec: 0.2, // a single repeat counts only if the aborted start was this short...
  loneRepeatMaxGapSec: 0.5, // ...and the second attempt followed this soon
  signatureSec: 0.08, // how much of each burst's start is compared
  similarity: 0.8, // cosine similarity of spectral shapes that counts as "the same sound"
};

/**
 * @param track frame track with `spec` (see analyzer.js)
 * @returns [{atSec, endSec, repeats, confirmed: null}]
 */
export function findRepetitions(track, options = {}) {
  const o = { ...REPETITION_DEFAULTS, ...options };
  const thresholdDb = options.speechThresholdDb ?? sessionThreshold(track);
  if (thresholdDb === null || !track.spec) return [];

  const { db, frameSec } = track;
  const units = burstUnits(db, frameSec, thresholdDb, o);
  const voice = averageSpectrum(track, thresholdDb);
  const signatures = units.map((u) => signature(track, u, voice, o));
  const sec = (frames) => frames * frameSec;
  const same = (i, j) => dot(signatures[i], signatures[j]) >= o.similarity;

  const found = [];
  for (let i = 0; i < units.length; ) {
    // Grow a chain of consecutive bursts that sound like the first one.
    let last = i;
    while (
      last + 1 < units.length &&
      sec(units[last].end - units[last].start) <= o.maxRepeatSec &&
      sec(units[last + 1].start - units[last].end) <= o.maxGapSec &&
      same(i, last + 1)
    ) {
      last++;
    }
    const repeats = last - i;
    const flagged =
      repeats >= 2 ||
      (repeats === 1 &&
        sec(units[i].end - units[i].start) <= o.loneRepeatMaxSec &&
        sec(units[i + 1].start - units[i].end) <= o.loneRepeatMaxGapSec);
    if (flagged) {
      found.push({ atSec: sec(units[i].start), endSec: sec(units[last].start), repeats, confirmed: null });
      i = last + 1;
    } else {
      i++;
    }
  }
  return found;
}

/** Stretches of sound separated by short silences. [start, end) in frames. */
function burstUnits(db, frameSec, thresholdDb, o) {
  const minGap = Math.max(1, Math.round(o.minGapSec / frameSec));
  const minUnit = Math.max(1, Math.round(o.minUnitSec / frameSec));
  const units = [];
  let start = -1;
  let quiet = 0;
  for (let i = 0; i <= db.length; i++) {
    const active = i < db.length && db[i] >= thresholdDb;
    if (active) {
      if (start < 0) start = i;
      quiet = 0;
    } else if (start >= 0 && (++quiet >= minGap || i === db.length)) {
      const end = i - quiet + 1;
      if (end - start >= minUnit) units.push({ start, end });
      start = -1;
      quiet = 0;
    }
  }
  return units;
}

/**
 * Average spectrum of all speech frames: the colour of this voice, microphone and room.
 * Every sound carries it, so it is subtracted before sounds are compared. Without this,
 * unrelated bursts looked 85% alike about a fifth of the time in testing.
 */
function averageSpectrum(track, thresholdDb) {
  const bands = track.specBands;
  const avg = new Array(bands).fill(0);
  let count = 0;
  for (let i = 0; i < track.db.length; i++) {
    if (track.db[i] < thresholdDb) continue;
    for (let b = 0; b < bands; b++) avg[b] += track.spec[i * bands + b];
    count++;
  }
  return count ? avg.map((v) => v / count) : avg;
}

/** Spectral shape of the start of a burst: voice colour and loudness removed, unit length. */
function signature(track, unit, voice, o) {
  const bands = track.specBands;
  const frames = Math.max(1, Math.round(o.signatureSec / track.frameSec));
  // The spectrum of frame i covers the ~30 ms before it, so skip the very first frame.
  const from = Math.min(unit.start + 1, unit.end - 1);
  const to = Math.min(unit.end, from + frames);
  const shape = new Array(bands).fill(0);
  for (let i = from; i < to; i++) {
    for (let b = 0; b < bands; b++) shape[b] += track.spec[i * bands + b] / (to - from);
  }
  for (let b = 0; b < bands; b++) shape[b] -= voice[b];
  const mean = shape.reduce((a, v) => a + v, 0) / bands;
  let norm = 0;
  for (let b = 0; b < bands; b++) {
    shape[b] -= mean;
    norm += shape[b] * shape[b];
  }
  norm = Math.sqrt(norm) || 1;
  return shape.map((v) => v / norm);
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
