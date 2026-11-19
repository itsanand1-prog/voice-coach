// F0 estimation with YIN (de Cheveigne & Kawahara 2002): difference function,
// cumulative-mean normalisation, absolute threshold, parabolic interpolation.

/**
 * @param {object} o
 * @param {number} o.sampleRate
 * @param {number} [o.fMin=60]  lowest detectable F0 (Hz)
 * @param {number} [o.fMax=500] highest detectable F0 (Hz)
 * @param {number} [o.windowSec=0.025] integration window
 * @param {number} [o.threshold=0.15] YIN aperiodicity threshold; above it the frame is unvoiced
 * @param {number} [o.minRms=0.001] frames quieter than this (-60 dBFS) are unvoiced
 */
export function createPitchDetector({
  sampleRate,
  fMin = 60,
  fMax = 500,
  windowSec = 0.025,
  threshold = 0.15,
  minRms = 0.001,
}) {
  const w = Math.round(windowSec * sampleRate);
  const tauMax = Math.ceil(sampleRate / fMin);
  const tauMin = Math.max(2, Math.floor(sampleRate / fMax));
  const frameLength = w + tauMax;
  const cmnd = new Float32Array(tauMax + 1);
  let aperiodicity = 1; // YIN dip depth of the last frame: 0 = perfectly periodic, 1 = none

  /** F0 in Hz of the frame starting at `offset`, or 0 if unvoiced. */
  function detect(buf, offset = 0) {
    aperiodicity = 1;
    if (buf.length - offset < frameLength) return 0;

    let energy = 0;
    for (let j = 0; j < w; j++) energy += buf[offset + j] * buf[offset + j];
    if (Math.sqrt(energy / w) < minRms) return 0;

    // Cumulative mean normalised difference function.
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let d = 0;
      for (let j = 0; j < w; j++) {
        const diff = buf[offset + j] - buf[offset + j + tau];
        d += diff * diff;
      }
      running += d;
      cmnd[tau] = running > 0 ? (d * tau) / running : 1;
    }

    // First dip under the threshold, followed down to its local minimum.
    let tau = tauMin;
    while (tau <= tauMax && cmnd[tau] >= threshold) tau++;
    if (tau > tauMax) {
      for (let k = tauMin; k <= tauMax; k++) aperiodicity = Math.min(aperiodicity, cmnd[k]);
      return 0;
    }
    while (tau < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
    aperiodicity = cmnd[tau];

    // Parabolic interpolation around the minimum for sub-sample period.
    let period = tau;
    if (tau > 1 && tau < tauMax) {
      const a = cmnd[tau - 1];
      const b = cmnd[tau];
      const c = cmnd[tau + 1];
      const denom = a - 2 * b + c;
      if (denom > 0) period = tau + (a - c) / (2 * denom);
    }
    return sampleRate / period;
  }

  return {
    frameLength,
    detect,
    /** Aperiodicity of the frame last passed to detect(); kept for threshold tuning. */
    get aperiodicity() {
      return aperiodicity;
    },
  };
}
