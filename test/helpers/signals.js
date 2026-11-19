// Synthetic test signals. Test-only code.

export function sine(freq, sec, sr, amp = 0.5) {
  const out = new Float32Array(Math.round(sec * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

// Voice-like tone: harmonics with 1/k amplitudes, normalised to peak `amp`.
export function harmonic(freq, sec, sr, amp = 0.5, harmonics = 10) {
  const out = new Float32Array(Math.round(sec * sr));
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let k = 1; k <= harmonics; k++) v += Math.sin((2 * Math.PI * freq * k * i) / sr) / k;
    out[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  for (let i = 0; i < out.length; i++) out[i] *= amp / peak;
  return out;
}

// Vowel-like sound: harmonics of f0 shaped by resonances ("formants"), with short fades so
// bursts start and stop cleanly. Different formant sets give clearly different spectra.
export function formantTone(f0, formants, sec, sr, amp = 0.4) {
  const out = new Float32Array(Math.round(sec * sr));
  const weights = [];
  for (let k = 1; k * f0 < sr / 2 - 500; k++) {
    let w = 0.02;
    for (const f of formants) w += 1 / (1 + ((k * f0 - f) / 90) ** 2);
    weights.push(w);
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let k = 0; k < weights.length; k++) v += weights[k] * Math.sin((2 * Math.PI * f0 * (k + 1) * i) / sr);
    out[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const fade = Math.min(Math.round(0.01 * sr), out.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const edge = Math.min(1, i / fade, (out.length - 1 - i) / fade);
    out[i] *= (amp / peak) * edge;
  }
  return out;
}

// Weighted sum of two equal-length signals.
export function mix(a, b, wa = 1, wb = 1) {
  return Float32Array.from(a, (v, i) => wa * v + wb * b[i]);
}

export function silence(sec, sr) {
  return new Float32Array(Math.round(sec * sr));
}

// Deterministic white noise (mulberry32).
export function noise(sec, sr, amp = 0.5, seed = 1) {
  const out = new Float32Array(Math.round(sec * sr));
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = amp * ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1);
  }
  return out;
}

export function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Metronome-like syllable train: raised-cosine amplitude modulation at rateHz,
// never fully silent (floor), so it stays one breath group.
export function syllableTrain(signal, rateHz, sr, floor = 0.1) {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < out.length; i++) {
    const m = 0.5 - 0.5 * Math.cos((2 * Math.PI * rateHz * i) / sr);
    out[i] = signal[i] * (floor + (1 - floor) * m);
  }
  return out;
}

// Linear fade-in over rampSec.
export function fadeIn(signal, rampSec, sr) {
  const out = Float32Array.from(signal);
  const n = Math.round(rampSec * sr);
  for (let i = 0; i < n && i < out.length; i++) out[i] *= i / n;
  return out;
}
