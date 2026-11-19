// Streaming front end: raw mono samples in, one {level, F0} frame out per 10 ms.
// Keeps no audio beyond a ~45 ms pitch window; only the frame track accumulates.

import { createPitchDetector } from './dsp/pitch.js';
import { createSpectrum, BANDS, SPECTRUM_SIZE } from './dsp/spectrum.js';

const PITCH_RATE_HZ = 16000; // pitch runs on audio decimated to roughly this rate
const HOP_SEC = 0.01;
export const DB_FLOOR = -120;
const SPECTRUM_MIN_DB = -70; // quieter frames get a flat floor spectrum without running the FFT

export class FrameAnalyzer {
  /**
   * @param {number} sampleRate input sample rate (e.g. 48000, 44100)
   * @param {object} [pitchOptions] overrides passed to createPitchDetector
   */
  constructor(sampleRate, pitchOptions = {}) {
    this.decimation = Math.max(1, Math.round(sampleRate / PITCH_RATE_HZ));
    const pitchRate = sampleRate / this.decimation;
    this.hopDec = Math.round(pitchRate * HOP_SEC);
    this.hopIn = this.hopDec * this.decimation;

    this.detector = createPitchDetector({ ...pitchOptions, sampleRate: pitchRate });
    this.window = new Float32Array(Math.max(this.detector.frameLength, SPECTRUM_SIZE));
    this.spectrum = createSpectrum(pitchRate);
    this.windowFill = 0;
    this.hop = new Float32Array(this.hopDec);

    this.hopFill = 0;
    this.inCount = 0;
    this.sumSq = 0;
    this.decAcc = 0;
    this.decCount = 0;

    /** Frame track: db[i] is RMS dBFS, f0[i] is Hz or 0 when unvoiced, ap[i] is YIN aperiodicity (0-1). */
    this.track = { frameSec: this.hopIn / sampleRate, db: [], f0: [], ap: [], spec: [], specBands: BANDS };
  }

  /** Feed samples (any chunk size). Returns the number of frames added. */
  push(samples) {
    let added = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      this.sumSq += s * s;
      this.decAcc += s;
      if (++this.decCount === this.decimation) {
        // Boxcar average doubles as a cheap anti-alias filter.
        this.hop[this.hopFill++] = this.decAcc / this.decimation;
        this.decAcc = 0;
        this.decCount = 0;
      }
      if (++this.inCount === this.hopIn) {
        this.#emitFrame();
        added++;
      }
    }
    return added;
  }

  #emitFrame() {
    const rms = Math.sqrt(this.sumSq / this.hopIn);
    const db = rms > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(rms)) : DB_FLOOR;

    this.window.copyWithin(0, this.hopDec);
    this.window.set(this.hop, this.window.length - this.hopDec);
    this.windowFill = Math.min(this.window.length, this.windowFill + this.hopDec);
    const pitchOffset = this.window.length - this.detector.frameLength;
    const f0 = this.windowFill === this.window.length ? this.detector.detect(this.window, pitchOffset) : 0;

    this.track.db.push(db);
    this.track.f0.push(f0);
    this.track.ap.push(this.windowFill === this.window.length ? this.detector.aperiodicity : 1);
    if (db >= SPECTRUM_MIN_DB) {
      const bands = this.spectrum(this.window, this.window.length - SPECTRUM_SIZE);
      for (let b = 0; b < BANDS; b++) this.track.spec.push(bands[b]);
    } else {
      for (let b = 0; b < BANDS; b++) this.track.spec.push(DB_FLOOR);
    }
    this.sumSq = 0;
    this.inCount = 0;
    this.hopFill = 0;
  }
}
