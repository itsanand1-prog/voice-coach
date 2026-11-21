import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewCandidates, countAnswers, selectForReview, MAX_REVIEW } from '../src/session/review.js';

const block = (atSec, gapSec = 0.5) => ({ atSec, gapSec, attemptSec: 0.1, confirmed: null });
const rep = (atSec, endSec, repeats = 2) => ({ atSec, endSec, repeats, confirmed: null });

test('review: a pause inside a repetition is listed once, as the repetition', () => {
  // In testing: "th ... th ... the" was flagged both as a repetition and as two blocks.
  const list = reviewCandidates([block(33.68), block(34.61)], [rep(33.13, 34.54, 3)], { part: 'Reading', offsetSec: 0 });
  // 34.61 is the pause right after the last short repeat, so it belongs to the repetition too.
  assert.deepEqual(list.map((c) => c.kind), ['repetition']);
  assert.equal(list[0].atSec, 33.13);
});

test('review: a block well after a repetition has finished is still listed', () => {
  const list = reviewCandidates([block(35.5)], [rep(33.13, 34.54, 3)], { part: 'Reading', offsetSec: 0 });
  assert.deepEqual(list.map((c) => c.kind), ['repetition', 'block']);
});

test('review: blocks away from any repetition are kept, in time order', () => {
  const list = reviewCandidates([block(26.68), block(4.09)], [rep(10.41, 10.77)], { part: 'Reading', offsetSec: 100 });
  assert.deepEqual(list.map((c) => [c.kind, c.atSec]), [['block', 104.09], ['repetition', 110.41], ['block', 126.68]]);
});

test('review: each entry says what was noticed, and starts unanswered', () => {
  const [b] = reviewCandidates([block(5, 0.7)], [], { part: 'Phone call', offsetSec: 0 });
  const [r] = reviewCandidates([], [rep(5, 5.4, 2)], { part: 'Phone call', offsetSec: 0 });
  assert.equal(b.part, 'Phone call');
  assert.match(b.detail, /0\.7 s pause/);
  assert.match(r.detail, /3 times/);
  assert.equal(b.answer, null);
});

// In testing: a break inside a word was flagged as a repetition, but it was a block.
// The app's label is only a guess, so the user says what each moment was.
test('review: the user decides what each moment was, whatever the app guessed', () => {
  const list = reviewCandidates([block(5), block(20)], [rep(10, 10.4), rep(30, 30.2)], { part: 'Reading', offsetSec: 0 });
  list[0].answer = 'block'; // guessed block, was a block
  list[1].answer = 'pause'; // guessed repetition, was a thinking pause
  list[2].answer = 'repetition'; // guessed block, was a repetition
  list[3].answer = 'block'; // guessed repetition, was a block
  assert.deepEqual(countAnswers(list), { confirmedBlocks: 2, confirmedRepetitions: 1, confirmedPauses: 1, repetitionCandidates: 2 });
});

test('review: unanswered moments are not counted as anything', () => {
  const list = reviewCandidates([block(5)], [rep(10, 10.4)], { part: 'Reading', offsetSec: 0 });
  assert.deepEqual(countAnswers(list), { confirmedBlocks: 0, confirmedRepetitions: 0, confirmedPauses: 0, repetitionCandidates: 1 });
});

test('review: entries keep what was measured, for tuning later', () => {
  const [b] = reviewCandidates([block(5, 0.7)], [], { part: 'Reading', offsetSec: 0 });
  const [r] = reviewCandidates([], [rep(9, 9.4, 3)], { part: 'Reading', offsetSec: 0 });
  assert.equal(b.gapSec, 0.7);
  assert.equal(b.attemptSec, 0.1);
  assert.equal(r.repeats, 3);
});

// In testing: 59 possible blocks, and only the first 12 by time were shown, so the
// later parts were never reviewed.
const cand = (kind, part, atSec, extra = {}) => ({ kind, part, atSec, attemptSec: 0.2, answer: null, ...extra });

test('review: at most 12 moments, drawn from every part, in time order', () => {
  assert.equal(MAX_REVIEW, 12);
  const list = [
    ...Array.from({ length: 30 }, (_, i) => cand('block', 'Breath', i)),
    ...Array.from({ length: 5 }, (_, i) => cand('block', 'Reading', 100 + i)),
    ...Array.from({ length: 2 }, (_, i) => cand('repetition', 'Phone', 300 + i)),
  ];
  const shown = selectForReview(list);
  assert.equal(shown.length, 12);
  assert.deepEqual(new Set(shown.map((c) => c.part)), new Set(['Breath', 'Reading', 'Phone']));
  assert.equal(shown.filter((c) => c.kind === 'repetition').length, 2);
  assert.deepEqual(shown.map((c) => c.atSec), [...shown.map((c) => c.atSec)].sort((a, b) => a - b));
});

// Reviewed in testing: same sound three or more times 3/3 real, twice 0/5;
// "blocks" with a 30-50 ms attempt 0/5 real; a confirmed block had a 170 ms attempt.
test('review: within a part, likeliest first: 3+ repeats, real-length attempts, 2 repeats, very short attempts', () => {
  const list = [
    cand('block', 'A', 1, { attemptSec: 0.03 }),
    cand('repetition', 'A', 2, { repeats: 1 }),
    cand('block', 'A', 3, { attemptSec: 0.17 }),
    cand('repetition', 'A', 4, { repeats: 2 }),
  ];
  assert.deepEqual(selectForReview(list, 1).map((c) => c.atSec), [4]);
  assert.deepEqual(selectForReview(list, 2).map((c) => c.atSec), [3, 4]);
  assert.deepEqual(selectForReview(list, 3).map((c) => c.atSec), [2, 3, 4]);
  assert.equal(selectForReview(list, 4).length, 4); // nothing is dropped, only ordered
});

test('review: when there are few moments, all are shown', () => {
  const list = [cand('block', 'A', 1), cand('repetition', 'B', 2)];
  assert.equal(selectForReview(list).length, 2);
});

test('review: a thinking pause is not counted as a block or a repetition', () => {
  const list = reviewCandidates([block(5), block(20)], [], { part: 'Reading', offsetSec: 0 });
  list[0].answer = 'pause';
  list[1].answer = 'neither';
  assert.deepEqual(countAnswers(list), { confirmedBlocks: 0, confirmedRepetitions: 0, confirmedPauses: 1, repetitionCandidates: 0 });
});
