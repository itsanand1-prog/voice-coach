import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LADDER_SPM, MIN_FLOW, evaluateBlock, recordBlock } from '../src/session/ladder.js';

test('ladder steps follow the programme: 60, 90, 120, 150, 190 syllables/min', () => {
  assert.deepEqual(LADDER_SPM, [60, 90, 120, 150, 190]);
});

// The karaoke pacer sets the rate, so a reading block is judged on whether the voice kept
// flowing (stretched, linked syllables) rather than on a syllable count, which doubles on
// stretched speech (about twice the true count in testing).
const good = { flow: 0.8, softOnsetShare: 0.7, ratingClose: true };

test('a block passes when the sound keeps flowing, soft starts are used and self-rating matches', () => {
  assert.equal(evaluateBlock(good).pass, true);
});

test('a block fails when the sound flows less than 70% of the time', () => {
  assert.equal(MIN_FLOW, 0.7);
  assert.equal(evaluateBlock({ ...good, flow: 0.57 }).pass, false);
  assert.equal(evaluateBlock({ ...good, flow: 0.57 }).flowOk, false);
  assert.equal(evaluateBlock({ ...good, flow: 0.7 }).flowOk, true);
});

test('a block fails when soft onsets are not used or the self-rating is far off', () => {
  assert.equal(evaluateBlock({ ...good, softOnsetShare: 0.4 }).pass, false);
  assert.equal(evaluateBlock({ ...good, ratingClose: false }).pass, false);
});

test('a block with no measurable flow does not pass', () => {
  assert.equal(evaluateBlock({ ...good, flow: null }).pass, false);
});

test('three passed blocks move up one step and reset the count', () => {
  let ladder = { step: 0, passes: 0 };
  let advanced;
  ({ ladder } = recordBlock(ladder, true));
  ({ ladder } = recordBlock(ladder, true));
  assert.deepEqual(ladder, { step: 0, passes: 2 });
  ({ ladder, advanced } = recordBlock(ladder, true));
  assert.deepEqual(ladder, { step: 1, passes: 0 });
  assert.equal(advanced, true);
});

test('a failed block costs nothing: passes already earned are kept', () => {
  const { ladder, advanced } = recordBlock({ step: 1, passes: 2 }, false);
  assert.deepEqual(ladder, { step: 1, passes: 2 });
  assert.equal(advanced, false);
});

test('the top step does not advance further', () => {
  const { ladder, advanced } = recordBlock({ step: 4, passes: 2 }, true);
  assert.equal(ladder.step, 4);
  assert.equal(advanced, false);
});
