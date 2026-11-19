import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, buildSchedule, positionAt, COUNT_IN_SEC } from '../src/live/karaoke.js';
import { READING_PASSAGES, PHRASES } from '../src/content/prompts.js';

// ---- parsing the syllable-marked text ----

test('parse: words split on spaces, syllables on middle dots', () => {
  const line = parseLine('The vil·lage ran a·long.');
  assert.deepEqual(
    line.words.map((w) => w.syllables),
    [['The'], ['vil', 'lage'], ['ran'], ['a', 'long.']],
  );
  assert.equal(line.count, 6);
});

test('parse: the plain text has no syllable marks', () => {
  assert.equal(parseLine('Ev·ery gar·den be·gins.').text, 'Every garden begins.');
});

// ---- timing ----

const lines = ['One two three four.', 'Five six se·ven.']; // 4 + 4 syllables

test('schedule: overall programme rate equals the target, pauses included', () => {
  for (const spm of [60, 90, 120, 190]) {
    const s = buildSchedule(lines, spm, { pauseBeats: 1 });
    assert.ok(Math.abs((8 / s.totalSec) * 60 - spm) < 1e-9, `at ${spm}: ${(8 / s.totalSec) * 60}`);
  }
});

test('schedule: every syllable gets the same time, with a breath pause after each line', () => {
  const s = buildSchedule(lines, 60, { pauseBeats: 1 });
  assert.equal(s.syllables.length, 8);
  const lengths = s.syllables.map((x) => x.end - x.start);
  for (const l of lengths) assert.ok(Math.abs(l - s.beatSec) < 1e-9);
  assert.deepEqual(s.pauses.map((p) => p.line), [0, 1]);
  assert.ok(Math.abs(s.pauses[0].start - 4 * s.beatSec) < 1e-9);
  assert.ok(Math.abs(s.syllables[4].start - 5 * s.beatSec) < 1e-9); // line 2 starts after the pause
});

test('schedule: syllables keep their line, word and position', () => {
  const s = buildSchedule(lines, 60, { pauseBeats: 1 });
  assert.deepEqual(
    [s.syllables[6], s.syllables[7]].map(({ line, word, syl }) => [line, word, syl]),
    [[1, 2, 0], [1, 2, 1]],
  );
});

test('position: counts in first, then moves through syllables and pauses, then ends', () => {
  const s = buildSchedule(lines, 60, { pauseBeats: 1 });
  const b = s.beatSec;
  assert.deepEqual(positionAt(s, -1.2), { phase: 'countIn', secondsLeft: 2 });
  assert.deepEqual(positionAt(s, 0), { phase: 'syllable', index: 0, line: 0, frac: 0 });
  const mid = positionAt(s, 1.5 * b);
  assert.equal(mid.index, 1);
  assert.ok(Math.abs(mid.frac - 0.5) < 1e-9);
  assert.deepEqual(positionAt(s, 4.5 * b).phase, 'pause');
  assert.equal(positionAt(s, 4.5 * b).line, 0);
  assert.equal(positionAt(s, 5.2 * b).index, 4);
  assert.deepEqual(positionAt(s, s.totalSec + 0.01), { phase: 'done' });
});

test('position: count-in lasts three seconds', () => {
  assert.equal(COUNT_IN_SEC, 3);
  const s = buildSchedule(lines, 60, { pauseBeats: 1 });
  assert.equal(positionAt(s, -3).secondsLeft, 3);
  assert.equal(positionAt(s, -0.1).secondsLeft, 1);
});

// ---- content ----

test('content: every reading line and phrase is syllable-marked and parses cleanly', () => {
  for (const line of [...READING_PASSAGES.flat(), ...PHRASES]) {
    const parsed = parseLine(line);
    assert.ok(parsed.count >= 3, `too short: ${line}`);
    for (const w of parsed.words) assert.ok(w.syllables.every((x) => /[A-Za-z]/.test(x)), `empty syllable in: ${line}`);
  }
  // Some lines are all one-syllable words, but every passage has marks.
  for (const passage of READING_PASSAGES) assert.ok(passage.join(' ').split('·').length > 10, 'passage lacks syllable marks');
});

test('content: no long unmarked word slipped through', () => {
  // Words of 8+ letters are almost never one syllable in this text.
  for (const line of [...READING_PASSAGES.flat(), ...PHRASES]) {
    for (const w of parseLine(line).words) {
      const letters = w.syllables.join('').replace(/[^A-Za-z]/g, '');
      if (letters.length >= 8) assert.ok(w.syllables.length > 1, `"${letters}" in: ${line}`);
    }
  }
});
