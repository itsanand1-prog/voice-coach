// Coarse spectral shape of a short frame: energy in 12 mel-spaced bands, in dB.
// Enough to tell whether two short bursts are "the same sound"; far too coarse to rebuild speech.

export const BANDS = 12;
const SIZE = 512; // samples per analysed frame (32 ms at 16 kHz)
const LOW_HZ = 100;
const HIGH_HZ = 6500;

const mel = (hz) => 2595 * Math.log10(1 + hz / 700);
const melInv = (m) => 700 * (10 ** (m / 2595) - 1);

/** Returns analyse(frame, offset) -> number[BANDS] of dB values, reusing its buffers. */
export function createSpectrum(sampleRate) {
  const re = new Float32Array(SIZE);
  const im = new Float32Array(SIZE);
  const hann = Float32Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1)));

  // Bit-reversal table and twiddle factors for an in-place radix-2 FFT.
  const bits = Math.log2(SIZE);
  const rev = new Uint16Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = Float32Array.from({ length: SIZE / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / SIZE));
  const sin = Float32Array.from({ length: SIZE / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / SIZE));

  // First FFT bin of each band (BANDS + 1 edges).
  const top = Math.min(HIGH_HZ, sampleRate * 0.45);
  const edges = Array.from({ length: BANDS + 1 }, (_, k) =>
    Math.round((melInv(mel(LOW_HZ) + ((mel(top) - mel(LOW_HZ)) * k) / BANDS) * SIZE) / sampleRate),
  );

  return function analyse(frame, offset = 0) {
    for (let i = 0; i < SIZE; i++) {
      re[rev[i]] = frame[offset + i] * hann[i];
      im[i] = 0;
    }
    for (let half = 1; half < SIZE; half <<= 1) {
      const step = SIZE / (half << 1);
      for (let start = 0; start < SIZE; start += half << 1) {
        for (let k = 0; k < half; k++) {
          const a = start + k;
          const b = a + half;
          const wr = cos[k * step];
          const wi = -sin[k * step];
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    const out = new Array(BANDS);
    for (let band = 0; band < BANDS; band++) {
      let energy = 0;
      const to = Math.max(edges[band] + 1, edges[band + 1]);
      for (let bin = edges[band]; bin < to; bin++) energy += re[bin] * re[bin] + im[bin] * im[bin];
      out[band] = 10 * Math.log10(energy / (SIZE * SIZE) + 1e-12);
    }
    return out;
  };
}

/** One-off convenience for a single 512-sample frame. */
export function bandEnergies(frame, sampleRate) {
  return createSpectrum(sampleRate)(frame);
}

export const SPECTRUM_SIZE = SIZE;
