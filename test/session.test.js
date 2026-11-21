import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEGMENTS, isCompleted, coreMinutes } from '../src/session/template.js';
import { sliceTrack, concatTracks } from '../src/track.js';
import { buildRecord } from '../src/session/record.js';
import { summarize } from '../src/summary.js';

test('template: core session is 15 to 20 minutes', () => {
  assert.ok(coreMinutes() >= 15 && coreMinutes() <= 20, `got ${coreMinutes()}`);
});

test('template: segments follow the design order, with the drill optional', () => {
  assert.deepEqual(SEGMENTS.map((s) => s.id), ['warmup', 'breath', 'reading', 'monologue', 'phone', 'spontaneous', 'drill']);
  assert.equal(SEGMENTS.find((s) => s.id === 'drill').optional, true);
  assert.equal(SEGMENTS.find((s) => s.id === 'reading').ladder, true);
});

test('template: a segment counts as completed at 80% of its time', () => {
  assert.equal(isCompleted(240, 240 * 0.8), true);
  assert.equal(isCompleted(240, 240 * 0.79), false);
});

const t = (db, f0 = 0) => ({ frameSec: 0.01, db, f0: db.map(() => f0) });

test('track: slice keeps the frame duration and copies the range', () => {
  const s = sliceTrack(t([-10, -20, -30, -40]), 1, 3);
  assert.deepEqual(s.db, [-20, -30]);
  assert.equal(s.frameSec, 0.01);
});

test('track: joining puts half a second of silence between parts', () => {
  const j = concatTracks([t([-10, -10]), t([-20])]);
  assert.equal(j.db.length, 2 + 50 + 1);
  assert.equal(j.db[2], -120);
  assert.equal(j.db[52], -20);
});

test('rate: programme rate stops the stopwatch only for pauses over 3 seconds', () => {
  const syll = (sec) => Array.from({ length: sec * 100 }, (_, i) => -30 + 6 * Math.cos((2 * Math.PI * 3 * i) / 100 + Math.PI));
  const gap = (sec) => new Array(sec * 100).fill(-70);
  const short = summarize(t([...syll(5), ...gap(1), ...syll(5)]), { speechThresholdDb: -45 });
  const long = summarize(t([...syll(5), ...gap(5), ...syll(5)]), { speechThresholdDb: -45 });
  assert.ok(Math.abs(short.rate.programSpm - (30 / 11) * 60) < 8, `short ${short.rate.programSpm}`);
  assert.ok(Math.abs(long.rate.programSpm - 180) < 8, `long ${long.rate.programSpm}`);
});

// ---- session record ----

function fakeSession() {
  // 1 syllable per second = 60 SPM
  const speech = Array.from({ length: 2000 }, (_, i) => -30 + 6 * Math.cos((2 * Math.PI * i) / 100 + Math.PI));
  const track = t([...new Array(1000).fill(-70), ...speech, ...speech], 150);
  return {
    track,
    startedAt: '2026-11-16T06:00:00.000Z',
    day: '2026-11-16',
    runs: [
      { id: 'warmup', from: 0, to: 1000, plannedSec: 10 },
      { id: 'reading', from: 1000, to: 3000, plannedSec: 20 },
      { id: 'phone', from: 3000, to: 3400, plannedSec: 20 },
    ],
    marks: [{ type: 'block', atSec: 12 }],
    selfRating: 3,
    confirmedBlocks: 1,
    ladderStep: 0,
    targetBand: null,
    breathGoalSec: 2,
    stoppedForSafety: false,
  };
}

test('record: each segment is summarised from its own slice and marked completed or not', () => {
  const r = buildRecord(fakeSession());
  assert.deepEqual(r.segments.map((s) => [s.id, s.completed]), [['warmup', true], ['reading', true], ['phone', false]]);
  assert.equal(r.segments[0].technique, null); // warm-up is not scored
  assert.ok(Math.abs(r.segments[1].metrics.rate.programSpm - 60) < 6);
});

test('record: session metrics exclude the warm-up', () => {
  const r = buildRecord(fakeSession());
  assert.ok(r.metrics.phonation.speechSec > 20 && r.metrics.phonation.speechSec < 25);
});

test('record: the reading segment is the ladder block, judged against the current step', () => {
  const r = buildRecord(fakeSession());
  assert.equal(r.readingTargetSpm, 60);
  assert.equal(r.ladderBlock.flowOk, true);
  assert.ok(r.readingFlow > 0.9, `flow ${r.readingFlow}`);
  assert.equal(typeof r.ladderBlock.pass, 'boolean');
});

test('record: holds metrics and marks only, never the frame track', () => {
  const r = buildRecord(fakeSession());
  const json = JSON.stringify(r);
  assert.ok(!('track' in r));
  assert.ok(json.length < 20000, `record is ${json.length} bytes`);
  assert.equal(r.marks.length, 1);
  assert.equal(r.schema, 2);
});

test('record: carries the repetition review counts', () => {
  const r = buildRecord({ ...fakeSession(), repetitionCandidates: 3, confirmedRepetitions: 2 });
  assert.equal(r.repetitionCandidates, 3);
  assert.equal(r.confirmedRepetitions, 2);
  assert.equal(buildRecord(fakeSession()).confirmedRepetitions, 0);
});

test('record: carries the thinking-pause count, 0 when absent', () => {
  assert.equal(buildRecord({ ...fakeSession(), confirmedPauses: 4 }).confirmedPauses, 4);
  assert.equal(buildRecord(fakeSession()).confirmedPauses, 0);
});

test('record: keeps the reviewed moments with the answers given', () => {
  const reviewed = [
    { kind: 'block', part: 'Reading', atSec: 14.2, gapSec: 0.6, attemptSec: 0.1, answer: 'neither' },
    { kind: 'repetition', part: 'Reading', atSec: 18, repeats: 3, answer: 'repetition' },
  ];
  const r = buildRecord({ ...fakeSession(), reviewed, flaggedTotal: 40 });
  assert.deepEqual(r.reviewed, reviewed);
  assert.equal(r.flaggedTotal, 40);
  assert.deepEqual(buildRecord(fakeSession()).reviewed, []);
});

test('record: notes voice processing the device would not switch off', () => {
  assert.deepEqual(buildRecord({ ...fakeSession(), micProcessing: ['autoGainControl'] }).micProcessing, ['autoGainControl']);
  assert.deepEqual(buildRecord(fakeSession()).micProcessing, []);
});

test('record: no ladder block when the reading segment was not completed', () => {
  const s = fakeSession();
  s.runs[1].plannedSec = 60;
  assert.equal(buildRecord(s).ladderBlock, null);
});
