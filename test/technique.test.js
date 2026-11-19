import { test } from 'node:test';
import assert from 'node:assert/strict';
import { softOnsetShare, techniqueScore, ratingFromScore, ratingClose } from '../src/game/technique.js';

test('soft onset share counts onsets with a rise of 80 ms or more', () => {
  assert.equal(softOnsetShare([20, 90, 120, 79]), 0.5);
  assert.equal(softOnsetShare([]), null);
});

test('perfect technique scores 100', () => {
  const s = techniqueScore({ riseMs: [100, 120], flow: 0.9, breathGroupMeanSec: 3, breathGoalSec: 2 });
  assert.equal(s.score, 100);
});

test('in paced parts, flow credit grows with flow and is full from 70%', () => {
  const base = { riseMs: [100], breathGroupMeanSec: 2, breathGoalSec: 2 };
  assert.equal(techniqueScore({ ...base, flow: 0.7 }).parts.flow, 1);
  assert.ok(Math.abs(techniqueScore({ ...base, flow: 0.35 }).parts.flow - 0.5) < 1e-9);
  assert.ok(techniqueScore({ ...base, flow: 0.35 }).score < techniqueScore({ ...base, flow: 0.7 }).score);
});

test('outside paced parts the score uses onsets and phrasing only', () => {
  const s = techniqueScore({ riseMs: [100, 20], flow: null, breathGroupMeanSec: 1, breathGoalSec: 2 });
  assert.equal(s.parts.flow, null);
  assert.equal(s.score, 50); // 50% soft onsets, 50% of breath goal
});

test('score is null when nothing was measurable', () => {
  assert.equal(techniqueScore({ riseMs: [], flow: null, breathGroupMeanSec: null, breathGoalSec: 2 }).score, null);
});

test('anti-goal: stuttering counts are not an input to the score', () => {
  const input = { riseMs: [100, 30], flow: 0.6, breathGroupMeanSec: 1.5, breathGoalSec: 2 };
  const clean = techniqueScore({ ...input, blocks: 0, repetitions: 0 }).score;
  const rough = techniqueScore({ ...input, blocks: 9, repetitions: 14 }).score;
  assert.equal(clean, rough);
});

test('self-rating 1-5 is close when within one point of the measured score', () => {
  assert.equal(ratingFromScore(0), 1);
  assert.equal(ratingFromScore(55), 3);
  assert.equal(ratingFromScore(100), 5);
  assert.equal(ratingClose(4, 55), true);
  assert.equal(ratingClose(5, 55), false);
  assert.equal(ratingClose(3, null), false);
});
