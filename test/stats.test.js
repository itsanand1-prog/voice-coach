import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, median, semitones } from '../src/dsp/stats.js';

test('percentile interpolates linearly between ranks', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([10, 20], 25), 12.5);
  assert.equal(percentile([5, 1, 3], 0), 1);
  assert.equal(percentile([5, 1, 3], 100), 5);
});

test('percentile does not reorder its input', () => {
  const xs = [3, 1, 2];
  percentile(xs, 50);
  assert.deepEqual(xs, [3, 1, 2]);
});

test('median and percentile of nothing are null', () => {
  assert.equal(median([]), null);
  assert.equal(percentile([], 90), null);
});

test('semitones between two frequencies', () => {
  assert.equal(semitones(200, 100), 12);
  assert.ok(Math.abs(semitones(100, 200) + 12) < 1e-12);
});
