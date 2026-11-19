import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameAnalyzer } from '../src/analyzer.js';
import { sine, silence, noise } from './helpers/signals.js';

// Phase 1 acceptance: F0 within +/-5 Hz of a reference tone, at real device rates.
for (const sr of [48000, 44100]) {
  for (const freq of [110, 220]) {
    test(`tracks a ${freq} Hz reference tone within 5 Hz at ${sr} Hz sample rate`, () => {
      const a = new FrameAnalyzer(sr);
      a.push(sine(freq, 1, sr));
      const voiced = a.track.f0.slice(10);
      assert.ok(voiced.length > 80);
      for (const f of voiced) assert.ok(Math.abs(f - freq) <= 5, `got ${f}`);
    });
  }
}

test('emits one frame per 10 ms', () => {
  const a = new FrameAnalyzer(48000);
  const added = a.push(sine(220, 1, 48000));
  assert.equal(added, 100);
  assert.equal(a.track.db.length, 100);
  assert.equal(a.track.f0.length, 100);
  assert.ok(Math.abs(a.track.frameSec - 0.01) < 1e-9);
});

test('reports level as RMS dBFS', () => {
  const a = new FrameAnalyzer(48000);
  // 200 Hz = whole cycles per 10 ms frame, so per-frame RMS is exact.
  a.push(sine(200, 0.5, 48000, 0.5));
  // sine of amplitude 0.5 -> RMS 0.3536 -> -9.03 dBFS
  for (const db of a.track.db.slice(1)) assert.ok(Math.abs(db - -9.03) < 0.2, `got ${db}`);
});

test('silence is unvoiced and floored at -120 dB', () => {
  const a = new FrameAnalyzer(48000);
  a.push(silence(0.3, 48000));
  assert.ok(a.track.f0.every((f) => f === 0));
  assert.ok(a.track.db.every((d) => d === -120));
});

test('records per-frame aperiodicity: low for a clean tone, high for noise', () => {
  const tone = new FrameAnalyzer(16000);
  tone.push(sine(150, 0.5, 16000));
  assert.equal(tone.track.ap.length, tone.track.f0.length);
  for (const ap of tone.track.ap.slice(10)) assert.ok(ap < 0.05, `tone got ${ap}`);

  const hiss = new FrameAnalyzer(16000);
  hiss.push(noise(0.5, 16000));
  for (const ap of hiss.track.ap.slice(10)) assert.ok(ap > 0.15 && ap <= 1, `noise got ${ap}`);
});

test('result does not depend on how the stream is chunked', () => {
  const sig = sine(180, 0.5, 48000);
  const whole = new FrameAnalyzer(48000);
  whole.push(sig);
  const chunked = new FrameAnalyzer(48000);
  for (let i = 0; i < sig.length; i += 128) chunked.push(sig.subarray(i, i + 128));
  assert.deepEqual(chunked.track.db, whole.track.db);
  assert.deepEqual(chunked.track.f0, whole.track.f0);
});
