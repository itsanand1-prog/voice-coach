import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameAnalyzer } from '../src/analyzer.js';
import { summarize } from '../src/summary.js';
import { sine, harmonic, silence, concat, syllableTrain, fadeIn } from './helpers/signals.js';

const SR = 16000;

function analyse(signal, opts) {
  const a = new FrameAnalyzer(SR);
  a.push(signal);
  return summarize(a.track, opts);
}

function near(actual, expected, tol, label = '') {
  assert.ok(Math.abs(actual - expected) <= tol, `${label} expected ${expected} +/- ${tol}, got ${actual}`);
}

// ---- F0 ----

test('pitch: median, 10th-90th percentile range in semitones, % time in target band', () => {
  const m = analyse(concat(sine(100, 3, SR), sine(200, 1, SR)), { targetBand: { lowHz: 90, highHz: 110 } });
  near(m.pitch.medianHz, 100, 2, 'median');
  near(m.pitch.p10Hz, 100, 2, 'p10');
  near(m.pitch.p90Hz, 200, 4, 'p90');
  near(m.pitch.rangeSemitones, 12, 0.5, 'range');
  near(m.pitch.pctInBand, 75, 3, 'in band');
});

test('pitch: % in band is null when no target band is set (week-1 baseline)', () => {
  const m = analyse(sine(120, 1, SR));
  assert.equal(m.pitch.pctInBand, null);
});

// ---- Loudness ----

test('loudness: median level of speech frames in dBFS', () => {
  const m = analyse(concat(silence(1, SR), sine(150, 2, SR, 0.5), silence(1, SR)));
  near(m.loudness.medianDb, -9.03, 0.3);
});

// ---- Syllable rate (Phase 1 acceptance: tracks a metronome, +/-10 SPM) ----

for (const spm of [120, 180, 240, 300]) {
  test(`rate: tracks a ${spm} syllables/min metronome-paced signal within 10 SPM`, () => {
    const m = analyse(syllableTrain(harmonic(120, 20, SR), spm / 60, SR));
    near(m.rate.articulationSpm, spm, 10);
  });
}

test('rate: a steady unmodulated tone is not counted as many syllables', () => {
  const m = analyse(harmonic(120, 5, SR));
  assert.ok(m.rate.syllables <= 1, `got ${m.rate.syllables}`);
});

test('rate: articulation rate excludes pauses, speech rate includes them', () => {
  const burst = syllableTrain(harmonic(120, 5, SR), 3, SR);
  const m = analyse(concat(burst, silence(5, SR), burst));
  near(m.rate.articulationSpm, 180, 12, 'articulation');
  near(m.rate.speechSpm, 120, 10, 'speech');
});

// ---- Phonation / pause, breath groups ----

test('phonation: speech time, interior pause time and phonation fraction', () => {
  const m = analyse(
    concat(silence(1, SR), sine(150, 2, SR), silence(1, SR), sine(150, 3, SR), silence(1, SR)),
  );
  near(m.phonation.speechSec, 5, 0.06, 'speech');
  near(m.phonation.pauseSec, 1, 0.06, 'pause'); // leading/trailing silence not counted
  near(m.phonation.fraction, 5 / 6, 0.02, 'fraction');
});

test('breath groups: count, mean and longest continuous phonation', () => {
  const m = analyse(
    concat(silence(1, SR), sine(150, 2, SR), silence(1, SR), sine(150, 3, SR), silence(1, SR)),
  );
  assert.equal(m.breathGroups.count, 2);
  near(m.breathGroups.meanSec, 2.5, 0.05, 'mean');
  near(m.breathGroups.maxSec, 3, 0.05, 'max');
});

test('breath groups: gaps shorter than the pause threshold do not split a group', () => {
  const m = analyse(concat(sine(150, 1, SR), silence(0.1, SR), sine(150, 1, SR)));
  assert.equal(m.breathGroups.count, 1);
  near(m.breathGroups.maxSec, 2.1, 0.05);
});

// ---- Flow ----

test('flow: share of stopwatch time with sound; pauses over 3 s do not count against it', () => {
  // 2 s sound, 1 s quiet, 2 s sound, 5 s quiet, 2 s sound: 6 s of sound in 7 s of stopwatch time.
  const m = analyse(concat(sine(150, 2, SR), silence(1, SR), sine(150, 2, SR), silence(5, SR), sine(150, 2, SR)));
  near(m.phonation.flow, 6 / 7, 0.02);
});

test('flow: null when there is no speech', () => {
  assert.equal(analyse(silence(2, SR)).phonation.flow, null);
});

// ---- Onset ramp ----

test('onset: hard onset has a short rise time, soft onset a long one', () => {
  const hard = fadeIn(sine(150, 1, SR), 0.02, SR);
  const soft = fadeIn(sine(150, 1, SR), 0.12, SR);
  const m = analyse(concat(silence(0.5, SR), hard, silence(0.5, SR), soft));
  assert.equal(m.onsets.count, 2);
  near(m.onsets.riseMs[0], 16, 12, 'hard'); // 10-90% of a 20 ms linear ramp
  near(m.onsets.riseMs[1], 96, 15, 'soft'); // 10-90% of a 120 ms linear ramp
  assert.ok(m.onsets.riseMs[0] < 40 && m.onsets.riseMs[1] > 80);
});

test('onset: quiet onset over room noise still gives a rise time inside the onset window', () => {
  // Found in testing: with a noise floor within 20 dB of the onset peak,
  // the 10% point was never reached and the search ran back to the start of the session.
  const db = [...new Array(300).fill(-50), ...new Array(100).fill(-35)];
  const m = summarize({ frameSec: 0.01, db, f0: db.map(() => 0) }, { speechThresholdDb: -45 });
  assert.equal(m.onsets.count, 1);
  assert.ok(m.onsets.riseMs[0] <= 30, `got ${m.onsets.riseMs[0]} ms for an abrupt onset`);
});

test('onset: rise time is measured above the pre-onset noise floor', () => {
  // 100 ms linear amplitude ramp from a -50 dB floor up to -20 dB: 10-90% of the rise is ~80 ms.
  const floor = 10 ** (-50 / 20);
  const top = 10 ** (-20 / 20);
  const ramp = Array.from({ length: 10 }, (_, i) => 20 * Math.log10(floor + ((top - floor) * (i + 0.5)) / 10));
  const db = [...new Array(100).fill(-50), ...ramp, ...new Array(100).fill(-20)];
  const m = summarize({ frameSec: 0.01, db, f0: db.map(() => 0) }, { speechThresholdDb: -45 });
  near(m.onsets.riseMs[0], 80, 12);
});

test('noise floor: reports the level of the quietest 5% of frames', () => {
  const db = [...new Array(50).fill(-62), ...new Array(50).fill(-30)];
  const m = summarize({ frameSec: 0.01, db, f0: db.map(() => 0) });
  assert.equal(m.noiseFloorDb, -62);
});

// ---- Tuning against real-voice test recordings ----

test('speech threshold: brief room-noise blips between phrases are not speech', () => {
  // Test recording: noise floor near -60 dBFS with blips to about -49, speech near -30.
  // A threshold of "95th percentile - 25 dB" sat inside the noise and produced false blocks.
  const phrase = new Array(200).fill(-30);
  const gap = [...new Array(48).fill(-60), ...new Array(4).fill(-49), ...new Array(48).fill(-60)];
  const db = [...phrase, ...gap, ...phrase, ...gap, ...phrase];
  const m = summarize({ frameSec: 0.01, db, f0: db.map(() => 0) });
  assert.equal(m.breathGroups.count, 3);
  assert.deepEqual(m.blockCandidates, []);
  assert.ok(m.speechThresholdDb > -49 && m.speechThresholdDb < -30, `got ${m.speechThresholdDb}`);
});

test('speech threshold: long stretches of room noise do not pull it into the noise', () => {
  // Found in testing: rests and quiet time made speech under 5% of frames, the threshold
  // sank to the top of the room noise, and noise was counted as speech (30 s "breath groups").
  let seed = 3;
  const roomNoise = (n) =>
    Array.from({ length: n }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const u = seed / 0x7fffffff;
      return -58 + 13 * u * u; // -58 .. -45 dBFS, mostly near the bottom with a thin upper tail
    });
  const phrase = Array.from({ length: 200 }, (_, i) => -30 + 6 * Math.cos((2 * Math.PI * 3 * i) / 100));
  const reading = [];
  for (let k = 0; k < 8; k++) reading.push(...roomNoise(50), ...phrase);
  const db = [...reading, ...roomNoise(12 * reading.length)]; // speech is about 6% of the session
  const m = summarize({ frameSec: 0.01, db, f0: db.map((d) => (d > -40 ? 150 : 0)) });
  assert.ok(m.speechThresholdDb > -44, `threshold ${m.speechThresholdDb} is inside the room noise`);
  assert.equal(m.breathGroups.count, 8);
  near(m.breathGroups.maxSec, 2, 0.1, 'longest breath group');
});

test('speech threshold: stays below a track that is all speech', () => {
  const db = Array.from({ length: 500 }, (_, i) => -30 + 2 * Math.sin(i / 7));
  const m = summarize({ frameSec: 0.01, db, f0: db.map(() => 0) });
  assert.equal(m.breathGroups.count, 1);
  near(m.phonation.speechSec, 5, 0.01);
});

test('rate: syllable peaks count even where pitch tracking drops out', () => {
  // Test recording: 43% of loud frames had no F0, and requiring voicing lost 28% of syllables.
  // 4 syllables/s for 5 s, 12 dB dips, no F0 at all.
  const db = Array.from({ length: 500 }, (_, i) => -30 + 6 * Math.cos((2 * Math.PI * 4 * i) / 100));
  const m = summarize({ frameSec: 0.01, db, f0: db.map(() => 0) }, { speechThresholdDb: -45 });
  near(m.rate.syllables, 20, 1);
});

// ---- Block proxy ----

test('block proxy: flags a silent gap that follows a short aborted attempt', () => {
  const m = analyse(
    concat(sine(150, 2, SR), silence(0.5, SR), sine(150, 0.15, SR), silence(0.8, SR), sine(150, 2, SR)),
  );
  assert.equal(m.blockCandidates.length, 1);
  near(m.blockCandidates[0].atSec, 2.65, 0.05, 'at');
  near(m.blockCandidates[0].gapSec, 0.8, 0.05, 'gap');
  near(m.blockCandidates[0].attemptSec, 0.15, 0.03, 'attempt');
});

test('block proxy: an ordinary pause between full phrases is not flagged', () => {
  const m = analyse(concat(sine(150, 2, SR), silence(0.8, SR), sine(150, 2, SR)));
  assert.equal(m.blockCandidates.length, 0);
});

test('block proxy: a short final fragment with no speech after it is not flagged', () => {
  const m = analyse(concat(sine(150, 2, SR), silence(0.5, SR), sine(150, 0.15, SR), silence(1, SR)));
  assert.equal(m.blockCandidates.length, 0);
});

// ---- Fatigue drift ----

test('drift: compares first window against last window for each metric', () => {
  const m = analyse(concat(sine(120, 6, SR, 0.5), sine(150, 6, SR, 0.25)), { driftWindowSec: 5 });
  assert.equal(m.drift.windowSec, 5);
  near(m.drift.pitchMedianHz.first, 120, 2);
  near(m.drift.pitchMedianHz.last, 150, 2);
  near(m.drift.pitchMedianHz.delta, 30, 3);
  near(m.drift.pitchMedianHz.deltaSemitones, 12 * Math.log2(150 / 120), 0.3);
  near(m.drift.loudnessMedianDb.delta, -6.02, 0.3);
});

test('drift: default window is 5 minutes for a long session', () => {
  const n = 20 * 60 * 100; // 20 min of 10 ms frames
  const track = { frameSec: 0.01, db: new Array(n).fill(-20), f0: new Array(n).fill(100) };
  assert.equal(summarize(track).drift.windowSec, 300);
});

test('drift: window shrinks to half the session when shorter than 10 minutes', () => {
  const n = 60 * 100; // 1 min
  const track = { frameSec: 0.01, db: new Array(n).fill(-20), f0: new Array(n).fill(100) };
  assert.equal(summarize(track).drift.windowSec, 30);
});

// ---- Degenerate input ----

test('empty track yields null metrics instead of throwing', () => {
  const m = summarize({ frameSec: 0.01, db: [], f0: [] });
  assert.equal(m.durationSec, 0);
  assert.equal(m.pitch.medianHz, null);
  assert.equal(m.rate.articulationSpm, null);
  assert.equal(m.breathGroups.count, 0);
  assert.deepEqual(m.blockCandidates, []);
});

test('all-silent track has no speech', () => {
  const m = analyse(silence(2, SR));
  assert.equal(m.phonation.speechSec, 0);
  assert.equal(m.breathGroups.count, 0);
  assert.equal(m.pitch.medianHz, null);
});
