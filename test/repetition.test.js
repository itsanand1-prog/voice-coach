import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandEnergies, BANDS } from '../src/dsp/spectrum.js';
import { FrameAnalyzer } from '../src/analyzer.js';
import { sliceTrack, concatTracks } from '../src/track.js';
import { findRepetitions } from '../src/repetition.js';
import { sine, silence, concat, formantTone, mix } from './helpers/signals.js';

const SR = 16000;

// ---- spectrum ----

test('spectrum: a pure tone puts its energy in the band that contains it', () => {
  const low = bandEnergies(sine(300, 0.032, SR).subarray(0, 512), SR);
  const high = bandEnergies(sine(3000, 0.032, SR).subarray(0, 512), SR);
  assert.equal(low.length, BANDS);
  const peak = (v) => v.indexOf(Math.max(...v));
  assert.ok(peak(low) < peak(high), `low tone peaked in band ${peak(low)}, high tone in ${peak(high)}`);
  assert.ok(peak(low) <= 2);
});

test('spectrum: louder input raises band energy by the same number of dB', () => {
  const a = bandEnergies(sine(1000, 0.032, SR, 0.1).subarray(0, 512), SR);
  const b = bandEnergies(sine(1000, 0.032, SR, 0.2).subarray(0, 512), SR);
  const k = a.indexOf(Math.max(...a));
  assert.ok(Math.abs(b[k] - a[k] - 6.02) < 0.1);
});

test('analyzer: stores one spectrum per frame', () => {
  const a = new FrameAnalyzer(48000);
  a.push(sine(220, 0.5, 48000));
  assert.equal(a.track.specBands, BANDS);
  assert.equal(a.track.spec.length, a.track.db.length * BANDS);
});

test('track: slicing and joining carry the spectra along', () => {
  const a = new FrameAnalyzer(SR);
  a.push(sine(220, 0.3, SR));
  const part = sliceTrack(a.track, 5, 15);
  assert.equal(part.spec.length, 10 * BANDS);
  assert.equal(part.spec[0], a.track.spec[5 * BANDS]);
  const joined = concatTracks([part, part]);
  assert.equal(joined.spec.length, joined.db.length * BANDS);
});

// ---- repetition detector ----
// Three "sounds" with clearly different spectral shapes.
const A = (sec) => formantTone(120, [700, 1200], sec, SR);
const B = (sec) => formantTone(120, [300, 2400], sec, SR);
const C = (sec) => formantTone(120, [450, 3200], sec, SR);
const gap = (sec) => silence(sec, SR);

function detect(signal) {
  const a = new FrameAnalyzer(SR);
  a.push(signal);
  return findRepetitions(a.track);
}

test('repetition: fluent speech with different sounds is not flagged', () => {
  const found = detect(concat(gap(0.5), A(0.25), gap(0.06), B(0.25), gap(0.06), C(0.25), gap(0.06), A(0.25), gap(0.5)));
  assert.deepEqual(found, []);
});

test('repetition: a sound repeated three times before the word is flagged once', () => {
  const found = detect(
    concat(gap(0.5), A(0.1), gap(0.1), A(0.1), gap(0.1), A(0.1), gap(0.1), A(0.4), gap(0.06), B(0.3), gap(0.5)),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].repeats, 3);
  assert.ok(Math.abs(found[0].atSec - 0.5) < 0.06, `at ${found[0].atSec}`);
  assert.equal(found[0].confirmed, null);
});

test('repetition: one short aborted start followed by the same sound is flagged', () => {
  const found = detect(concat(gap(0.5), B(0.25), gap(0.06), A(0.12), gap(0.15), A(0.4), gap(0.5)));
  assert.equal(found.length, 1);
  assert.equal(found[0].repeats, 1);
});

test('repetition: a full word said twice ("very very") is not flagged', () => {
  const found = detect(concat(gap(0.5), A(0.3), gap(0.06), A(0.3), gap(0.06), B(0.3), gap(0.5)));
  assert.deepEqual(found, []);
});

test('repetition: repeats separated by a long pause are separate attempts, not one repetition', () => {
  const found = detect(concat(gap(0.5), A(0.12), gap(1.0), A(0.4), gap(0.5)));
  assert.deepEqual(found, []);
});

test('repetition: two separate repetitions in one stretch are both found', () => {
  const rep = (S) => concat(S(0.1), gap(0.1), S(0.1), gap(0.1), S(0.1), gap(0.1), S(0.4));
  const found = detect(concat(gap(0.5), rep(A), gap(0.06), C(0.3), gap(0.06), rep(B), gap(0.5)));
  assert.equal(found.length, 2);
});

// ---- Found on a test recording with deliberate repetitions ----

test('repetition: repeats with pauses of up to a second between attempts are one repetition', () => {
  // Real pattern: "th ... th ... th ... the", 40-90 ms bursts with 400-900 ms between them.
  const found = detect(
    concat(gap(0.5), B(0.3), gap(0.06), A(0.06), gap(0.5), A(0.08), gap(0.8), A(0.07), gap(0.6), C(0.4), gap(0.06), B(0.3), gap(0.5)),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].repeats, 2);
});

test('repetition: a single repeat still needs the second attempt within half a second', () => {
  const found = detect(concat(gap(0.5), B(0.3), gap(0.06), A(0.1), gap(0.7), A(0.4), gap(0.06), C(0.3), gap(0.5)));
  assert.deepEqual(found, []);
});

test('repetition: different sounds that share the same overall voice colour are not confused', () => {
  // Real speech: every sound carries the same broad spectral tilt of the voice and microphone,
  // which made unrelated bursts look 85% alike. Here a strong shared component plus a weak
  // distinguishing one stands in for that.
  const colour = (sec) => formantTone(120, [250], sec, SR);
  const sound = (detailHz) => (sec) => mix(colour(sec), formantTone(120, [detailHz], sec, SR), 1, 0.25);
  const [X, Y, Z, W] = [900, 1700, 2600, 3600].map(sound);
  const found = detect(
    concat(gap(0.5), X(0.1), gap(0.1), Y(0.1), gap(0.1), Z(0.1), gap(0.1), W(0.3), gap(0.06), X(0.3), gap(0.06), Z(0.3), gap(0.5)),
  );
  assert.deepEqual(found, []);
});

test('repetition: silence yields nothing', () => {
  assert.deepEqual(detect(gap(2)), []);
});
