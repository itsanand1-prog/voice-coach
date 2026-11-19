import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord } from '../src/session/record.js';
import { withinPartDrift, MIN_DRIFT_PARTS } from '../src/session/drift.js';

// Syllable-like level envelope at `hz` syllables per second, always voiced.
const syllables = (sec, hz) => Array.from({ length: Math.round(sec * 100) }, (_, i) => -30 + 6 * Math.cos((2 * Math.PI * hz * i) / 100 + Math.PI));

function session(parts) {
  // parts: [{id, db}] laid end to end after 5 s of silence
  const db = new Array(500).fill(-70);
  const runs = [{ id: 'warmup', from: 0, to: 500, plannedSec: 5 }];
  for (const p of parts) {
    runs.push({ id: p.id, from: db.length, to: db.length + p.db.length, plannedSec: p.db.length / 100 });
    db.push(...p.db);
  }
  return {
    track: { frameSec: 0.01, db, f0: db.map((d) => (d > -40 ? 150 : 0)) },
    startedAt: '2026-11-18T06:00:00.000Z',
    day: '2026-11-18',
    runs,
    marks: [],
    selfRating: 3,
    confirmedBlocks: 0,
    ladderStep: 0,
    targetBand: null,
    breathGoalSec: 2,
    stoppedForSafety: false,
  };
}

test('drift: parts at different but steady rates show no drift', () => {
  // Found in testing: the slow-rate parts come first and free speech comes last, so comparing
  // the first and last five minutes showed "speeding up" by 70 syllables/min that was only the task.
  const r = buildRecord(
    session([
      { id: 'reading', db: syllables(20, 1) }, // 60 syllables/min throughout
      { id: 'monologue', db: syllables(20, 3) }, // 180 syllables/min throughout
      { id: 'spontaneous', db: syllables(20, 3) },
    ]),
  );
  const d = r.metrics.drift;
  assert.equal(d.method, 'within-parts');
  assert.equal(d.parts, 3);
  assert.ok(Math.abs(d.articulationSpm.delta) < 10, `delta ${d.articulationSpm.delta}`);
});

test('drift: speeding up inside a part is caught', () => {
  const r = buildRecord(
    session([
      { id: 'reading', db: [...syllables(10, 1), ...syllables(10, 2)] }, // 60 -> 120
      { id: 'monologue', db: [...syllables(10, 2), ...syllables(10, 3)] }, // 120 -> 180
      { id: 'spontaneous', db: syllables(20, 2) },
    ]),
  );
  const d = r.metrics.drift;
  assert.ok(d.articulationSpm.delta > 25, `delta ${d.articulationSpm.delta}`);
});

test('drift: each part is weighted by how long it was spoken', () => {
  const part = (first, last, sec) => ({
    speechSec: sec,
    drift: {
      windowSec: sec / 2,
      articulationSpm: { first, last, delta: last - first },
      breathGroupMeanSec: { first: 2, last: 2, delta: 0 },
      pitchMedianHz: { first: 150, last: 150, delta: 0, deltaSemitones: 0 },
    },
  });
  const d = withinPartDrift([part(100, 130, 30), part(200, 200, 90)]);
  assert.equal(d.articulationSpm.first, 175); // (100*30 + 200*90) / 120
  assert.equal(d.articulationSpm.last, 182.5); // (130*30 + 200*90) / 120
});

test('drift: parts with nothing measurable are left out', () => {
  const empty = { speechSec: 0, drift: { windowSec: 0, articulationSpm: { first: null, last: null, delta: null }, breathGroupMeanSec: { first: null, last: null, delta: null }, pitchMedianHz: { first: null, last: null, delta: null, deltaSemitones: null } } };
  assert.equal(withinPartDrift([empty]).parts, 0);
  assert.equal(MIN_DRIFT_PARTS, 3);
});

// ---- older records ----
import { initialState, applySession } from '../src/game/progress.js';

test('progress: a record saved with whole-session drift is scored from its parts instead', () => {
  const part = (id, first, last) => ({
    id,
    completed: true,
    technique: 50,
    metrics: {
      phonation: { speechSec: 60 },
      drift: {
        windowSec: 45,
        articulationSpm: { first, last, delta: last - first },
        breathGroupMeanSec: { first: 2, last: 2, delta: 0 },
        pitchMedianHz: { first: 160, last: 160, delta: 0, deltaSemitones: 0 },
      },
    },
  });
  const r = {
    day: '2026-11-17',
    durationSec: 1200,
    segments: [{ id: 'warmup', completed: true, technique: null, metrics: {} }, part('breath', 200, 200), part('reading', 200, 202), part('monologue', 200, 201)],
    metrics: {
      pitch: { medianHz: 160, pctInBand: null, voicedSec: 200 },
      phonation: { speechSec: 380 },
      loudness: { p90Db: -26 },
      noiseFloorDb: -68,
      breathGroups: { maxSec: 4, meanSec: 0.9 },
      rate: { programSpm: 100 },
      drift: { windowSec: 300, articulationSpm: { first: 150, last: 250, delta: 100 }, breathGroupMeanSec: { first: 1, last: 1, delta: 0 }, pitchMedianHz: { first: 160, last: 160, delta: 0, deltaSemitones: 0 } },
    },
    softOnsetShare: 0.4,
    onsetCount: 100,
    readingTargetSpm: 60,
    readingSpm: 90,
    ladderBlock: null,
    marks: [],
    confirmedBlocks: 0,
    stoppedForSafety: false,
  };
  const { state } = applySession(initialState(), r);
  assert.ok(state.bests.driftScore >= 95, `got ${state.bests.driftScore}`); // whole-session figure would give 0
  assert.ok(state.badges['fatigue-fighter']);
});
