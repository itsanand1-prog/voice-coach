// Session metrics from a frame track ({frameSec, db[], f0[]}), DESIGN.md section 6.
// Pure functions: no audio, no browser APIs.

import { percentile, median, semitones } from './dsp/stats.js';

export const DEFAULTS = {
  targetBand: null, // {lowHz, highHz}; null until the user approves a target (week-1 baseline)
  pauseSec: 0.25, // silence at least this long ends a breath group
  minGroupSec: 0.03, // shorter bursts are treated as clicks, not speech
  speechRangeDb: [15, 30], // speech threshold is kept this far below the 95th-percentile level
  minSpeechDb: -60, // absolute floor for the speech threshold (dBFS)
  noiseMarginDb: 14, // speech threshold is at least this far above the room-noise floor...
  noiseGateDb: 28, // ...when loud speech (99th percentile) is at least this far above that floor
  onsetWindowSec: 0.15, // rise time is measured over this long after an onset
  onsetLookbackSec: 0.1, // ...and the rise may begin at most this long before it
  syllableDipDb: 2, // dip needed between two envelope peaks to count two syllables
  attemptMaxSec: 0.3, // block proxy: a fragment this short counts as an aborted attempt
  blockMaxGapSec: 5, // block proxy: longer gaps are treated as stopping, not blocking
  stopwatchPauseSec: 3, // programme rate ignores pauses longer than this (Boberg & Kully, via Ward ch. 9)
  driftWindowSec: 300, // fatigue drift: first vs last 5 min (halved for short sessions)
};

export function summarize(track, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const { frameSec, db, f0 } = track;
  const n = db.length;
  const thresholdDb = options.speechThresholdDb ?? speechThreshold(db, o);

  const whole = measure(db, f0, frameSec, thresholdDb, o);

  const windowFrames = Math.round(Math.min(o.driftWindowSec, (n * frameSec) / 2) / frameSec);
  const first = measure(db.slice(0, windowFrames), f0.slice(0, windowFrames), frameSec, thresholdDb, o);
  const last = measure(db.slice(n - windowFrames), f0.slice(n - windowFrames), frameSec, thresholdDb, o);

  return {
    durationSec: n * frameSec,
    speechThresholdDb: thresholdDb,
    noiseFloorDb: percentile(db, 5), // quietest 5% of frames: room + microphone noise
    ...whole,
    drift: {
      windowSec: windowFrames * frameSec,
      pitchMedianHz: {
        ...pair(first.pitch.medianHz, last.pitch.medianHz),
        deltaSemitones:
          first.pitch.medianHz && last.pitch.medianHz
            ? semitones(last.pitch.medianHz, first.pitch.medianHz)
            : null,
      },
      loudnessMedianDb: pair(first.loudness.medianDb, last.loudness.medianDb),
      articulationSpm: pair(first.rate.articulationSpm, last.rate.articulationSpm),
      phonationFraction: pair(first.phonation.fraction, last.phonation.fraction),
      breathGroupMeanSec: pair(first.breathGroups.meanSec, last.breathGroups.meanSec),
      onsetRiseMedianMs: pair(first.onsets.medianRiseMs, last.onsets.medianRiseMs),
      blockCandidates: pair(first.blockCandidates.length, last.blockCandidates.length),
    },
  };
}

/** Speech threshold for a track with default settings (used by the live display). */
export function sessionThreshold(track) {
  return speechThreshold(track.db, DEFAULTS);
}

function pair(first, last) {
  return { first, last, delta: first === null || last === null ? null : last - first };
}

/** Level above which a frame counts as speech; null if the track holds no speech. */
function speechThreshold(db, o) {
  const p95 = percentile(db, 95);
  if (p95 === null || p95 < o.minSpeechDb + 5) return null;
  const [nearest, farthest] = o.speechRangeDb;
  const split = Math.min(p95 - nearest, Math.max(p95 - farthest, noiseSpeechMidpoint(db)));

  // The 95th percentile sinks when a session holds much more quiet time than speech (rests,
  // reading instructions), dragging the split into the room noise. The quietest 5% of frames
  // is room noise however long the session is, so it anchors a lower limit. In three clean
  // recordings the working threshold sat 14-17 dB above it. Only applied when there is real
  // silence to measure: in a track that is nearly all speech, p05 is speech, not noise.
  const floor = percentile(db, 5);
  const loud = percentile(db, 99);
  const noiseLimit = loud - floor >= o.noiseGateDb ? floor + o.noiseMarginDb : -Infinity;

  return Math.max(split, noiseLimit, o.minSpeechDb);
}

/**
 * Levels in a session fall into two clusters, room noise and speech. Split them with
 * Otsu's method on a 0.5 dB histogram and return the level midway between the cluster means.
 */
function noiseSpeechMidpoint(db) {
  const BIN = 0.5;
  const LOW = -120;
  const bins = new Float64Array(Math.round(-LOW / BIN) + 1);
  for (const d of db) bins[Math.round((Math.min(0, Math.max(LOW, d)) - LOW) / BIN)]++;

  let total = 0;
  for (let k = 0; k < bins.length; k++) total += k * bins[k];
  let best = -1;
  let midpoint = LOW;
  let count = 0;
  let sum = 0;
  for (let k = 0; k < bins.length - 1; k++) {
    count += bins[k];
    sum += k * bins[k];
    const above = db.length - count;
    if (count === 0 || above === 0) continue;
    const meanLow = sum / count;
    const meanHigh = (total - sum) / above;
    const between = count * above * (meanHigh - meanLow) ** 2;
    if (between > best) {
      best = between;
      midpoint = LOW + (BIN * (meanLow + meanHigh)) / 2;
    }
  }
  return midpoint;
}

function measure(db, f0, frameSec, thresholdDb, o) {
  const groups = thresholdDb === null ? [] : breathGroups(db, frameSec, thresholdDb, o);

  const groupSecs = groups.map((g) => (g.end - g.start) * frameSec);
  const speechSec = groupSecs.reduce((a, b) => a + b, 0);
  let pauseSec = 0;
  for (let k = 1; k < groups.length; k++) pauseSec += (groups[k].start - groups[k - 1].end) * frameSec;

  const voiced = [];
  const levels = [];
  for (const g of groups) {
    for (let i = g.start; i < g.end; i++) {
      if (f0[i] > 0) voiced.push(f0[i]);
      if (db[i] >= thresholdDb) levels.push(db[i]);
    }
  }

  const p10 = percentile(voiced, 10);
  const p90 = percentile(voiced, 90);
  const band = o.targetBand;
  const inBand = band ? voiced.filter((f) => f >= band.lowHz && f <= band.highHz).length : 0;

  const onsetGroups = groups.filter((g) => g.start > 0);
  const riseMs = onsetGroups.map((g) => onsetRiseMs(db, g.start, frameSec, o));

  // Programme ("stopwatch") time: speaking time plus ordinary pauses; the stopwatch stops
  // only for pauses longer than stopwatchPauseSec.
  let stopwatchSec = speechSec;
  for (let k = 1; k < groups.length; k++) {
    const gap = (groups[k].start - groups[k - 1].end) * frameSec;
    if (gap <= o.stopwatchPauseSec) stopwatchSec += gap;
  }
  const syllables = countSyllables(db, groups, thresholdDb, o);

  const blockCandidates = [];
  for (let k = 0; k + 1 < groups.length; k++) {
    const gapSec = (groups[k + 1].start - groups[k].end) * frameSec;
    if (groupSecs[k] <= o.attemptMaxSec && gapSec <= o.blockMaxGapSec) {
      blockCandidates.push({
        atSec: groups[k].end * frameSec,
        gapSec,
        attemptSec: groupSecs[k],
        confirmed: null, // proxy only: the user confirms or rejects it
      });
    }
  }

  return {
    pitch: {
      medianHz: median(voiced),
      p10Hz: p10,
      p90Hz: p90,
      rangeSemitones: voiced.length ? semitones(p90, p10) : null,
      pctInBand: band && voiced.length ? (100 * inBand) / voiced.length : null,
      voicedSec: voiced.length * frameSec,
    },
    loudness: {
      medianDb: median(levels),
      p10Db: percentile(levels, 10),
      p90Db: percentile(levels, 90),
    },
    onsets: {
      count: riseMs.length,
      medianRiseMs: median(riseMs),
      riseMs,
      atSec: onsetGroups.map((g) => g.start * frameSec),
    },
    rate: {
      syllables,
      programSpm: stopwatchSec > 0 ? (60 * syllables) / stopwatchSec : null,
      articulationSpm: speechSec > 0 ? (60 * syllables) / speechSec : null,
      speechSpm: speechSec > 0 ? (60 * syllables) / (speechSec + pauseSec) : null,
    },
    phonation: {
      speechSec,
      pauseSec,
      fraction: speechSec > 0 ? speechSec / (speechSec + pauseSec) : null,
      stopwatchSec,
      // Share of stopwatch time with sound: high for stretched, linked speech, low for
      // word-by-word speech with gaps. Pauses over stopwatchPauseSec are left out.
      flow: stopwatchSec > 0 ? speechSec / stopwatchSec : null,
    },
    breathGroups: {
      count: groups.length,
      meanSec: groups.length ? speechSec / groups.length : null,
      medianSec: median(groupSecs),
      maxSec: groups.length ? Math.max(...groupSecs) : null,
    },
    blockCandidates,
  };
}

/** Runs of speech frames, with gaps shorter than the pause threshold bridged. [start, end) */
function breathGroups(db, frameSec, thresholdDb, o) {
  const pauseFrames = Math.round(o.pauseSec / frameSec);
  const minFrames = Math.round(o.minGroupSec / frameSec);
  const groups = [];
  let start = -1;
  for (let i = 0; i <= db.length; i++) {
    const active = i < db.length && db[i] >= thresholdDb;
    if (active && start < 0) start = i;
    if (!active && start >= 0) {
      const prev = groups[groups.length - 1];
      if (prev && start - prev.end < pauseFrames) prev.end = i;
      else groups.push({ start, end: i });
      start = -1;
    }
  }
  return groups.filter((g) => g.end - g.start >= minFrames);
}

/** 10%-90% amplitude rise time at an onset, in ms (soft vs hard onset proxy). */
function onsetRiseMs(db, start, frameSec, o) {
  const hi = Math.min(db.length - 1, start + Math.round(o.onsetWindowSec / frameSec));
  const lo = Math.max(0, start - Math.round(o.onsetLookbackSec / frameSec));

  // Measure the rise above the room-noise level just before the onset, so a quiet
  // voice over audible noise still has a reachable 10% point.
  let floor = Infinity;
  for (let i = lo; i < start; i++) floor = Math.min(floor, 10 ** (db[i] / 20));
  const amp = (i) => Math.max(0, 10 ** (db[i] / 20) - floor);

  let peak = 0;
  for (let i = start; i <= hi; i++) peak = Math.max(peak, amp(i));

  let i90 = start;
  while (i90 < hi && amp(i90) < 0.9 * peak) i90++;
  let i10 = i90;
  while (i10 > lo && amp(i10) >= 0.1 * peak) i10--;

  const cross = (i, level) => {
    // fractional frame index where amplitude rises through `level` between i-1 and i
    if (i === 0 || amp(i) === amp(i - 1)) return i;
    return i - 1 + Math.min(1, Math.max(0, (level - amp(i - 1)) / (amp(i) - amp(i - 1))));
  };
  const t90 = cross(i90, 0.9 * peak);
  const t10 = amp(i10) < 0.1 * peak ? cross(i10 + 1, 0.1 * peak) : i10;
  return Math.max(0, t90 - t10) * frameSec * 1000;
}

/**
 * Syllable nuclei: peaks of the smoothed level envelope separated by a dip.
 * Voicing is deliberately not required: on a real voice the pitch tracker misses
 * enough voiced frames that the requirement lost over a quarter of the syllables.
 */
function countSyllables(db, groups, thresholdDb, o) {
  const n = db.length;
  const smooth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      sum += db[j];
      count++;
    }
    smooth[i] = sum / count;
  }

  let total = 0;
  for (const g of groups) {
    let lastPeak = null;
    let minSince = Infinity;
    for (let i = Math.max(1, g.start); i < Math.min(n - 1, g.end); i++) {
      const v = smooth[i];
      minSince = Math.min(minSince, v);
      const isPeak = v > smooth[i - 1] && v >= smooth[i + 1] && v >= thresholdDb;
      if (!isPeak) continue;
      if (lastPeak === null || minSince <= Math.min(lastPeak, v) - o.syllableDipDb) {
        total++;
        lastPeak = v;
        minSince = v;
      } else if (v > lastPeak) {
        lastPeak = v; // same syllable, higher nucleus
        minSince = v;
      }
    }
  }
  return total;
}
