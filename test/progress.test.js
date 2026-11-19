import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applySession, updateStreak, levelForXp, xpForSession, driftScore } from '../src/game/progress.js';

const seg = (id, completed = true, technique = 60) => ({ id, completed, technique });
function record(over = {}) {
  return {
    day: '2026-11-16',
    durationSec: 1100,
    segments: [seg('warmup', true, null), seg('breath'), seg('reading'), seg('monologue'), seg('phone'), seg('spontaneous')],
    metrics: {
      pitch: { medianHz: 150, pctInBand: null, voicedSec: 300 },
      phonation: { speechSec: 600 },
      loudness: { p90Db: -26 },
      noiseFloorDb: -60,
      breathGroups: { maxSec: 3, meanSec: 1.2 },
      rate: { programSpm: 62 },
      drift: null,
    },
    softOnsetShare: 0.5,
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

// ---- streak ----

test('streak: first session starts a streak of 1', () => {
  assert.deepEqual(updateStreak({ current: 0, best: 0, lastDay: null, freezes: 0 }, '2026-11-16').streak,
    { current: 1, best: 1, lastDay: '2026-11-16', freezes: 0 });
});

test('streak: a second session on the same day changes nothing', () => {
  const s = { current: 3, best: 5, lastDay: '2026-11-16', freezes: 1 };
  assert.deepEqual(updateStreak(s, '2026-11-16').streak, s);
});

test('streak: the next day extends it, across a month boundary too', () => {
  assert.equal(updateStreak({ current: 3, best: 3, lastDay: '2026-11-30', freezes: 0 }, '2026-12-01').streak.current, 4);
});

test('streak: every 7th day earns one freeze token', () => {
  const r = updateStreak({ current: 6, best: 6, lastDay: '2026-11-15', freezes: 0 }, '2026-11-16');
  assert.equal(r.streak.current, 7);
  assert.equal(r.streak.freezes, 1);
  assert.equal(r.freezeEarned, true);
});

test('streak: a missed day uses a freeze and the streak continues', () => {
  const r = updateStreak({ current: 8, best: 8, lastDay: '2026-11-14', freezes: 1 }, '2026-11-16');
  assert.equal(r.streak.current, 9);
  assert.equal(r.streak.freezes, 0);
  assert.equal(r.freezesUsed, 1);
});

test('streak: a missed day without a freeze restarts at 1 but keeps the best', () => {
  const r = updateStreak({ current: 8, best: 8, lastDay: '2026-11-14', freezes: 0 }, '2026-11-16');
  assert.equal(r.streak.current, 1);
  assert.equal(r.streak.best, 8);
});

test('streak: more missed days than freezes restarts and leaves the freezes unspent', () => {
  const r = updateStreak({ current: 8, best: 8, lastDay: '2026-11-10', freezes: 1 }, '2026-11-16');
  assert.equal(r.streak.current, 1);
  assert.equal(r.streak.freezes, 1);
});

// ---- XP and levels ----

test('xp: 10 per completed segment, technique bonus per speech segment, transfer bonuses', () => {
  // 6 completed x 10 = 60; technique 5 speech segments x 6 = 30; phone 15 + monologue 10 = 25
  assert.equal(xpForSession(record()), 115);
});

test('xp: a skipped segment earns nothing for that segment and costs nothing else', () => {
  const r = record();
  r.segments[4] = seg('phone', false, null);
  assert.equal(xpForSession(r), 115 - 10 - 6 - 15);
});

test('xp: the modification drill earns a bonus', () => {
  const r = record();
  r.segments.push(seg('drill', true, null));
  assert.equal(xpForSession(r), 115 + 10 + 5);
});

test('anti-goal: marked blocks and repetitions do not change XP', () => {
  const rough = record({ marks: [{ type: 'block', atSec: 3 }, { type: 'repetition', atSec: 9 }], confirmedBlocks: 4, repetitionCandidates: 6, confirmedRepetitions: 5 });
  assert.equal(xpForSession(rough), xpForSession(record()));
});

test('levels: 100 XP for level 2, 300 for level 3, 600 for level 4', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(299), 2);
  assert.equal(levelForXp(300), 3);
  assert.equal(levelForXp(600), 4);
});

// ---- applySession ----

test('first session: totals, streak, XP and the First Session badge', () => {
  const { state, events } = applySession(initialState(), record());
  assert.equal(state.sessions, 1);
  assert.equal(state.xp, 115);
  assert.equal(state.streak.current, 1);
  assert.ok(state.badges['first-session']);
  assert.ok(events.some((e) => e.type === 'badge' && e.id === 'first-session'));
  assert.ok(events.some((e) => e.type === 'level' && e.level === 2));
});

test('a missed week never reduces lifetime totals', () => {
  let { state } = applySession(initialState(), record({ day: '2026-11-01' }));
  ({ state } = applySession(state, record({ day: '2026-11-20' })));
  assert.equal(state.sessions, 2);
  assert.equal(state.xp, 230);
  assert.equal(state.lifetimeSec, 2200);
  assert.equal(state.streak.current, 1);
});

test('a session stopped for a sore throat still counts as a practice day', () => {
  const r = record({ stoppedForSafety: true });
  r.segments = [seg('warmup', true, null), seg('breath', false, null)];
  const { state } = applySession(initialState(), r);
  assert.equal(state.streak.current, 1);
  assert.equal(state.sessions, 1);
  assert.equal(state.xp, 10);
});

test('badges: Baseline Done after five sessions with pitch data', () => {
  let state = initialState();
  for (let d = 1; d <= 5; d++) ({ state } = applySession(state, record({ day: `2026-11-0${d}` })));
  assert.ok(state.badges['baseline-done']);
  assert.equal(state.baselineHz.length, 5);
});

test('badges: 7-Day Streak', () => {
  let state = initialState();
  for (let d = 1; d <= 7; d++) ({ state } = applySession(state, record({ day: `2026-11-0${d}` })));
  assert.ok(state.badges['streak-7']);
  assert.equal(state.streak.freezes, 1);
});

test('badges: Soft Starter needs 70% soft onsets over at least 10 onsets', () => {
  assert.ok(applySession(initialState(), record({ softOnsetShare: 0.72 })).state.badges['soft-starter']);
  assert.ok(!applySession(initialState(), record({ softOnsetShare: 0.72, onsetCount: 4 })).state.badges['soft-starter']);
});

test('badges: Steady Flow when the voice keeps flowing 70% of the reading', () => {
  assert.ok(applySession(initialState(), record({ readingFlow: 0.72 })).state.badges['steady-pace']);
  assert.ok(!applySession(initialState(), record({ readingFlow: 0.57 })).state.badges['steady-pace']);
});

test('badges: Deep Resonance needs an approved band and 60% of voiced time inside it', () => {
  const r = record();
  r.metrics.pitch.pctInBand = 64;
  assert.ok(applySession(initialState(), r).state.badges['deep-resonance']);
  assert.ok(!applySession(initialState(), record()).state.badges['deep-resonance']);
});

test('badges: Phone Warrior after five completed phone segments', () => {
  let state = initialState();
  for (let d = 1; d <= 5; d++) ({ state } = applySession(state, record({ day: `2026-11-0${d}` })));
  assert.ok(state.badges['phone-warrior']);
});

test('badges: Ladder Step Up when the reading block advances the ladder', () => {
  const start = { ...initialState(), ladder: { step: 0, passes: 2 } };
  const { state, events } = applySession(start, record({ ladderBlock: { pass: true } }));
  assert.deepEqual(state.ladder, { step: 1, passes: 0 });
  assert.ok(state.badges['ladder-step-up']);
  assert.ok(events.some((e) => e.type === 'ladder'));
});

test('badges: Breath Master when mean breath group beats the baseline by 25%', () => {
  let state = initialState();
  for (let d = 1; d <= 5; d++) ({ state } = applySession(state, record({ day: `2026-11-0${d}` })));
  const better = record({ day: '2026-11-06' });
  better.metrics.breathGroups.meanSec = 1.6; // baseline mean 1.2 -> goal 1.5
  ({ state } = applySession(state, better));
  assert.ok(state.badges['breath-master']);
});

test('badges are awarded once', () => {
  const { state } = applySession(initialState(), record());
  const { events } = applySession(state, record({ day: '2026-11-17' }));
  assert.ok(!events.some((e) => e.type === 'badge' && e.id === 'first-session'));
});

test('personal bests: longest breath group and best streak', () => {
  let { state } = applySession(initialState(), record());
  assert.equal(state.bests.longestBreathGroupSec, 3);
  const longer = record({ day: '2026-11-17' });
  longer.metrics.breathGroups.maxSec = 4.5;
  let events;
  ({ state, events } = applySession(state, longer));
  assert.equal(state.bests.longestBreathGroupSec, 4.5);
  assert.equal(state.bests.streak, 2);
  assert.ok(events.some((e) => e.type === 'best' && e.id === 'longestBreathGroupSec'));
});

// ---- drift ----

const drift = (rate, breath, st) => ({
  method: 'within-parts',
  parts: 5,
  windowSec: 90,
  articulationSpm: { first: 200, last: 200 * (1 + rate), delta: 200 * rate },
  breathGroupMeanSec: { first: 2, last: 2 * (1 + breath), delta: 2 * breath },
  pitchMedianHz: { first: 150, last: 150, delta: 0, deltaSemitones: st },
});

test('drift score: 100 when the end of the session matches the start', () => {
  assert.equal(driftScore(drift(0, 0, 0)), 100);
});

test('drift score: drops when rate speeds up, breath groups shorten and pitch rises', () => {
  const s = driftScore(drift(0.2, -0.3, 1.5));
  assert.ok(s < 60 && s >= 0, `got ${s}`);
});

test('drift score: improvements late in the session are not penalised', () => {
  assert.equal(driftScore(drift(-0.1, 0.4, -1)), 100);
});

test('drift score: needs at least three speaking parts', () => {
  assert.equal(driftScore({ ...drift(0, 0, 0), parts: 2 }), null);
  assert.equal(driftScore(null), null);
});

test('drift score: whole-session drift saved by older versions is not used', () => {
  // It compared slow-rate parts with free speech, so it measured the task, not fatigue.
  const { method, parts, ...old } = drift(0, 0, 0);
  assert.equal(driftScore({ ...old, windowSec: 300 }), null);
});

test('badges: Fatigue Fighter for a drift score of 85 or more, tracked as a personal best', () => {
  const r = record();
  r.metrics.drift = drift(0.02, -0.03, 0.1);
  const { state } = applySession(initialState(), r);
  assert.ok(state.badges['fatigue-fighter']);
  assert.ok(state.bests.driftScore >= 85);
});
