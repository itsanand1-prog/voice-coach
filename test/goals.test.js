import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, generateWeeklyGoals, goalProgress } from '../src/game/goals.js';
import { baselineMedianHz, proposeBand, MAX_STEPS_DOWN } from '../src/game/pitchTarget.js';

const rec = (day, breath, soft) => ({ day, metrics: { breathGroups: { meanSec: breath } }, softOnsetShare: soft });

test('weeks start on Monday', () => {
  assert.equal(weekStart('2026-11-15'), '2026-11-09'); // Sunday
  assert.equal(weekStart('2026-11-16'), '2026-11-16'); // Monday
  assert.equal(weekStart('2026-11-18'), '2026-11-16');
});

test('three goals are generated from last week: practice days, breath groups, soft onsets', () => {
  const goals = generateWeeklyGoals([rec('2026-11-09', 1.0, 0.4), rec('2026-11-10', 1.2, 0.5), rec('2026-11-10', 1.1, 0.6)]);
  assert.deepEqual(goals.map((g) => g.id), ['practiceDays', 'breathGroupMeanSec', 'softOnsetShare']);
  assert.equal(goals[0].target, 3); // 2 distinct days last week + 1
  assert.ok(Math.abs(goals[1].target - 1.21) < 0.01); // mean 1.1 + 10%
  assert.ok(Math.abs(goals[2].target - 0.55) < 0.001); // mean 0.5 + 5 points
});

test('goals stay reachable: at most 7 days, at most 90% soft onsets', () => {
  const week = Array.from({ length: 7 }, (_, i) => rec(`2026-11-${String(9 + i).padStart(2, '0')}`, 2, 0.88));
  const goals = generateWeeklyGoals(week);
  assert.equal(goals[0].target, 7);
  assert.equal(goals[2].target, 0.9);
});

test('with no data last week, starter goals are used', () => {
  const goals = generateWeeklyGoals([]);
  assert.equal(goals.length, 3);
  assert.equal(goals[0].target, 3);
});

test('progress compares this week against each target', () => {
  const goals = generateWeeklyGoals([rec('2026-11-09', 1.0, 0.5)]);
  const p = goalProgress(goals, [rec('2026-11-16', 1.3, 0.4), rec('2026-11-17', 1.1, 0.5)]);
  // targets: 3 practice days (the minimum), 1.1 s breath groups, 55% soft starts
  assert.deepEqual(p.map((g) => g.met), [false, true, false]);
  assert.equal(p[0].value, 2);
});

// ---- pitch target ----

test('baseline needs five sessions and is the median of their median pitch', () => {
  assert.equal(baselineMedianHz([150, 152, 158, 160]), null);
  assert.equal(baselineMedianHz([150, 152, 158, 160, 156, 400]), 156); // first five only
});

test('each approved step lowers the centre by one semitone, with a band of 3 semitones either side', () => {
  const b = proposeBand(156, 1);
  assert.ok(Math.abs(b.centerHz - 156 / 2 ** (1 / 12)) < 0.01);
  assert.ok(Math.abs(12 * Math.log2(b.highHz / b.centerHz) - 3) < 1e-9);
  assert.ok(Math.abs(12 * Math.log2(b.centerHz / b.lowHz) - 3) < 1e-9);
  assert.equal(b.semitonesBelowBaseline, 1);
});

test('zero steps gives a band centred on the baseline', () => {
  assert.equal(proposeBand(156, 0).centerHz, 156);
});

test('the target is never more than a third (3 semitones) below baseline', () => {
  assert.equal(MAX_STEPS_DOWN, 3);
  assert.equal(proposeBand(156, 9).semitonesBelowBaseline, 3);
});
