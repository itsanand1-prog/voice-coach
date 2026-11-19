import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPitchDetector } from '../src/dsp/pitch.js';
import { sine, harmonic, noise, silence } from './helpers/signals.js';

const SR = 16000;

for (const freq of [80, 110, 147, 220, 330, 440]) {
  test(`detects a ${freq} Hz sine within 1 Hz`, () => {
    const det = createPitchDetector({ sampleRate: SR });
    const f0 = det.detect(sine(freq, 0.2, SR));
    assert.ok(Math.abs(f0 - freq) <= 1, `got ${f0}`);
  });
}

test('detects the fundamental of a harmonic-rich (voice-like) tone', () => {
  const det = createPitchDetector({ sampleRate: SR });
  const f0 = det.detect(harmonic(110, 0.2, SR));
  assert.ok(Math.abs(f0 - 110) <= 1, `got ${f0}`);
});

test('reports white noise as unvoiced (0)', () => {
  const det = createPitchDetector({ sampleRate: SR });
  assert.equal(det.detect(noise(0.2, SR)), 0);
});

test('reports silence as unvoiced (0)', () => {
  const det = createPitchDetector({ sampleRate: SR });
  assert.equal(det.detect(silence(0.2, SR)), 0);
});

test('reads the frame starting at the given offset', () => {
  const det = createPitchDetector({ sampleRate: SR });
  const buf = new Float32Array(SR);
  buf.set(sine(220, 0.5, SR), SR / 2);
  assert.equal(det.detect(buf, 0), 0);
  assert.ok(Math.abs(det.detect(buf, SR / 2) - 220) <= 1);
});

test('frameLength covers the integration window plus the longest period', () => {
  const det = createPitchDetector({ sampleRate: SR, fMin: 60, windowSec: 0.025 });
  assert.equal(det.frameLength, 400 + Math.ceil(SR / 60));
});
