import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalQuality } from '../src/session/quality.js';
import { buildRecord } from '../src/session/record.js';
import { initialState, applySession, rebuildState, RULES_VERSION } from '../src/game/progress.js';

// Shapes follow the compact metrics stored in a session record.
const metrics = ({ voicedSec = 12, speechSec = 24, p90Db = -26, noiseFloorDb = -60 } = {}) => ({
  pitch: { medianHz: 156, pctInBand: null, voicedSec },
  phonation: { speechSec },
  loudness: { p90Db },
  noiseFloorDb,
  breathGroups: { maxSec: 3, meanSec: 1.2 },
  rate: { programSpm: 62 },
  drift: null,
});

test('quality: a clean recording is reliable', () => {
  const q = signalQuality(metrics());
  assert.equal(q.reliable, true);
  assert.equal(q.voicedShare, 0.5);
  assert.equal(q.marginDb, 34);
});

test('quality: unreliable when little of the "speech" is voiced', () => {
  // Found in testing: 106 s voiced out of 697 s counted as speech (15%), with 30 s "breath groups".
  // Room noise was being counted as speech. Clean recordings sat at 40-53%.
  const q = signalQuality(metrics({ voicedSec: 105.7, speechSec: 697.3, p90Db: -30, noiseFloorDb: -53.3 }));
  assert.equal(q.reliable, false);
  assert.ok(q.reasons.includes('noise-as-speech'));
});

test('quality: unreliable when the voice is not well above the room noise', () => {
  const q = signalQuality(metrics({ p90Db: -38, noiseFloorDb: -52 }));
  assert.equal(q.reliable, false);
  assert.ok(q.reasons.includes('low-margin'));
});

test('quality: no speech at all is not reliable', () => {
  assert.equal(signalQuality(metrics({ voicedSec: 0, speechSec: 0 })).reliable, false);
});

// ---- record ----

function session(f0) {
  const speech = Array.from({ length: 2000 }, (_, i) => -30 + 6 * Math.cos((2 * Math.PI * i) / 100 + Math.PI));
  const db = [...new Array(1000).fill(-70), ...speech];
  return {
    track: { frameSec: 0.01, db, f0: db.map((d) => (d > -40 ? f0 : 0)) },
    startedAt: '2026-11-16T06:00:00.000Z',
    day: '2026-11-16',
    runs: [{ id: 'warmup', from: 0, to: 1000, plannedSec: 10 }, { id: 'reading', from: 1000, to: 3000, plannedSec: 20 }],
    marks: [],
    selfRating: 3,
    confirmedBlocks: 0,
    ladderStep: 0,
    targetBand: null,
    breathGoalSec: 2,
    stoppedForSafety: false,
  };
}

test('record: stores the quality verdict', () => {
  assert.equal(buildRecord(session(150)).quality.reliable, true);
  assert.equal(buildRecord(session(0)).quality.reliable, false);
});

test('record: an unreliable session does not produce a ladder block', () => {
  assert.notEqual(buildRecord(session(150)).ladderBlock, null);
  assert.equal(buildRecord(session(0)).ladderBlock, null);
});

// ---- progress ----

const seg = (id, completed = true, technique = 60) => ({ id, completed, technique });
function record(over = {}) {
  return {
    day: '2026-11-16',
    durationSec: 1100,
    segments: [seg('warmup', true, null), seg('breath'), seg('reading'), seg('monologue'), seg('phone'), seg('spontaneous')],
    metrics: metrics({ voicedSec: 300, speechSec: 600 }),
    softOnsetShare: 0.8,
    onsetCount: 30,
    readingTargetSpm: 60,
    readingSpm: 62,
    readingFlow: 0.8,
    ladderBlock: null,
    marks: [],
    confirmedBlocks: 0,
    stoppedForSafety: false,
    ...over,
  };
}
const noisy = (over = {}) => {
  const r = record(over);
  r.metrics = metrics({ voicedSec: 90, speechSec: 600 });
  r.metrics.breathGroups = { maxSec: 30, meanSec: 2.6 };
  return r;
};

test('progress: an unreliable session still counts as practice', () => {
  const { state } = applySession(initialState(), noisy());
  assert.equal(state.sessions, 1);
  assert.equal(state.streak.current, 1);
  assert.equal(state.lifetimeSec, 1100);
  assert.ok(state.badges['first-session']);
});

test('progress: an unreliable session earns completion and transfer XP but no technique XP', () => {
  // 6 parts x 10 + phone 15 + monologue 10; the 5 x 6 technique points are left out.
  assert.equal(applySession(initialState(), noisy()).state.xp, 85);
  assert.equal(applySession(initialState(), record()).state.xp, 115);
});

test('progress: an unreliable session does not feed baseline, bests or measurement badges', () => {
  const { state } = applySession(initialState(), noisy());
  assert.deepEqual(state.baselineHz, []);
  assert.deepEqual(state.baselineBreathSec, []);
  assert.equal(state.bests.longestBreathGroupSec, null);
  assert.ok(!state.badges['soft-starter']);
  assert.ok(!state.badges['steady-pace']);
});

test('progress: a record saved before quality checks existed is judged from its stored metrics', () => {
  const old = noisy();
  delete old.quality;
  assert.equal(applySession(initialState(), old).state.bests.longestBreathGroupSec, null);
});

test('rebuild: replaying stored sessions under current rules removes a bogus personal best', () => {
  // A session saved under the old rules with a 30 s "breath group" as a best.
  const saved = { ...initialState(), xp: 999, bests: { longestBreathGroupSec: 30, driftScore: null, streak: 1 }, baselineBreathSec: [2.6], pitchStepsDown: 1, ladder: { step: 2, passes: 1 } };
  const state = rebuildState(saved, [noisy({ day: '2026-11-15' }), record({ day: '2026-11-16' })]);
  assert.equal(state.sessions, 2);
  assert.equal(state.bests.longestBreathGroupSec, 3);
  assert.deepEqual(state.baselineBreathSec, [1.2]);
  assert.equal(state.streak.current, 2);
});

test('rebuild: never lowers XP or takes away an earned badge', () => {
  // Design rule: nothing is ever taken away. A session that earned 96 XP under the old
  // rules; replaying it under the new ones gives 75.
  const saved = { ...initialState(), xp: 96, badges: { 'first-session': '2026-11-15', 'soft-starter': '2026-11-15' } };
  const state = rebuildState(saved, [noisy({ day: '2026-11-15' })]);
  assert.equal(state.xp, 96);
  assert.equal(state.badges['soft-starter'], '2026-11-15');
  assert.equal(state.badges['first-session'], '2026-11-15');
});

test('rebuild: XP rises if the current rules give more', () => {
  const state = rebuildState({ ...initialState(), xp: 10 }, [record()]);
  assert.equal(state.xp, 115);
});

test('rebuild: marks the state with the current rules version', () => {
  assert.equal(rebuildState({ ...initialState(), rulesVersion: 1 }, [record()]).rulesVersion, RULES_VERSION);
});

test('rebuild: keeps the choices the user made by hand', () => {
  const saved = { ...initialState(), pitchStepsDown: 1, ladder: { step: 2, passes: 1 } };
  const state = rebuildState(saved, [record()]);
  assert.equal(state.pitchStepsDown, 1);
  assert.deepEqual(state.ladder, { step: 2, passes: 1 });
});

test('rebuild: sessions are replayed in date order whatever order they are stored in', () => {
  const state = rebuildState(initialState(), [
    record({ day: '2026-11-17', startedAt: '2026-11-17T06:00:00Z' }),
    record({ day: '2026-11-16', startedAt: '2026-11-16T06:00:00Z' }),
  ]);
  assert.equal(state.streak.current, 2);
});
