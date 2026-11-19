import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCue, CUES } from '../src/live/cues.js';
import { liveSnapshot } from '../src/live/snapshot.js';

const calm = { rateSpm: 60, flow: 0.85, breathGroupSec: 2, hardOnsetStreak: 0, secSinceLastOnset: 1, recentPitchHz: 150 };
const cfg = { paced: true, band: { lowHz: 120, highHz: 170 } };
const idle = { nowSec: 100, lastCueAtSec: 0 };

test('no cue when everything is within range', () => {
  assert.equal(pickCue(calm, cfg, idle), null);
});

test('"keep sound flowing" in paced parts when the voice sounds under 60% of the time', () => {
  assert.equal(pickCue({ ...calm, flow: 0.55 }, cfg, idle), 'flow');
  assert.equal(pickCue({ ...calm, flow: 0.65 }, cfg, idle), null);
});

test('no flow cue outside paced parts, and no rate cue anywhere', () => {
  // The syllable count doubles on stretched speech, so a rate cue would nag someone who is
  // following the pacer correctly.
  assert.equal(pickCue({ ...calm, flow: 0.3 }, { ...cfg, paced: false }, idle), null);
  assert.equal(pickCue({ ...calm, rateSpm: 200 }, cfg, idle), null);
});

test('"soft start" after two hard onsets in a row, only just after an onset', () => {
  assert.equal(pickCue({ ...calm, hardOnsetStreak: 2 }, cfg, idle), 'softStart');
  assert.equal(pickCue({ ...calm, hardOnsetStreak: 1 }, cfg, idle), null);
  assert.equal(pickCue({ ...calm, hardOnsetStreak: 2, secSinceLastOnset: 6 }, cfg, idle), null);
});

test('"breathe" when one breath group runs past the limit', () => {
  assert.equal(pickCue({ ...calm, breathGroupSec: 8 }, cfg, idle), 'breathe');
});

test('"pitch drifting up" only when an approved band exists', () => {
  assert.equal(pickCue({ ...calm, recentPitchHz: 180 }, cfg, idle), 'pitchUp');
  assert.equal(pickCue({ ...calm, recentPitchHz: 180 }, { ...cfg, band: null }, idle), null);
});

test('breathing outranks the other cues', () => {
  assert.equal(pickCue({ rateSpm: 90, flow: 0.2, breathGroupSec: 9, hardOnsetStreak: 3, secSinceLastOnset: 1, recentPitchHz: 190 }, cfg, idle), 'breathe');
});

test('cues are spaced at least 8 seconds apart', () => {
  assert.equal(pickCue({ ...calm, flow: 0.3 }, cfg, { nowSec: 105, lastCueAtSec: 100 }), null);
  assert.equal(pickCue({ ...calm, flow: 0.3 }, cfg, { nowSec: 108, lastCueAtSec: 100 }), 'flow');
});

test('every cue has short on-screen text', () => {
  for (const id of ['flow', 'softStart', 'breathe', 'pitchUp']) assert.ok(CUES[id].text.length <= 20);
  assert.equal(CUES.slowDown, undefined);
});

// ---- snapshot ----

function track(...parts) {
  const db = parts.flat();
  return { frameSec: 0.01, db, f0: db.map((d) => (d > -40 ? 150 : 0)) };
}
const speech = (sec) => new Array(Math.round(sec * 100)).fill(-30);
const quiet = (sec) => new Array(Math.round(sec * 100)).fill(-60);

test('snapshot: breath timer shows the length of the breath group in progress', () => {
  const s = liveSnapshot(track(quiet(1), speech(2), quiet(1), speech(4.2)), { thresholdDb: -45 });
  assert.ok(Math.abs(s.breathGroupSec - 4.2) < 0.05, `got ${s.breathGroupSec}`);
});

test('snapshot: breath timer returns to zero once a pause is reached', () => {
  const s = liveSnapshot(track(speech(3), quiet(0.5)), { thresholdDb: -45 });
  assert.equal(s.breathGroupSec, 0);
});

test('snapshot: recent pitch is the median over the window', () => {
  const s = liveSnapshot(track(quiet(1), speech(3)), { thresholdDb: -45 });
  assert.equal(s.recentPitchHz, 150);
});

test('snapshot: flow is the share of recent time with sound, long pauses left out', () => {
  // 0.6 s of sound then 0.4 s of quiet, repeated: 60% flow.
  const pattern = [];
  for (let k = 0; k < 10; k++) pattern.push(...speech(0.6), ...quiet(0.4));
  const s = liveSnapshot(track(quiet(5), pattern), { thresholdDb: -45 });
  assert.ok(Math.abs(s.flow - 0.6) < 0.05, `got ${s.flow}`);
});

test('snapshot: no rate is reported until there is enough speech', () => {
  const s = liveSnapshot(track(quiet(1), speech(1)), { thresholdDb: -45 });
  assert.equal(s.rateSpm, null);
});

test('snapshot: counts hard onsets in a row, most recent first', () => {
  const softRamp = Array.from({ length: 15 }, (_, i) => 20 * Math.log10((0.0316 * (i + 0.5)) / 15));
  const t = track(quiet(1), softRamp, speech(1), quiet(1), speech(1), quiet(1), speech(1));
  const s = liveSnapshot(t, { thresholdDb: -45 });
  assert.equal(s.hardOnsetStreak, 2);
  assert.ok(s.secSinceLastOnset >= 0.9 && s.secSinceLastOnset <= 1.1);
});

test('the flow cue repeats at most every 20 seconds', () => {
  const low = { ...calm, flow: 0.4 };
  assert.equal(pickCue(low, cfg, { nowSec: 110, lastCueAtSec: 100, lastFlowCueAtSec: 100 }), null);
  assert.equal(pickCue(low, cfg, { nowSec: 120, lastCueAtSec: 100, lastFlowCueAtSec: 100 }), 'flow');
});
