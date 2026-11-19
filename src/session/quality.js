// Can this session's measurements be trusted?
// In testing, a long session in a noisy room counted room noise as speech: 15% of "speech" was voiced (clean
// recordings: 40-53%) and "breath groups" ran to 30 s. Practice still counts in that case,
// but nothing should be judged or remembered from the numbers.

export const MIN_VOICED_SHARE = 0.3; // voiced time / time counted as speech
export const MIN_MARGIN_DB = 20; // loud speech (90th percentile) above the room-noise floor

/**
 * @param metrics       summarize() output or the compact form stored in a record
 * @param noiseFloorDb  floor of the whole capture if known; defaults to the metrics' own
 * @returns {reliable, voicedShare, marginDb, reasons: ('noise-as-speech' | 'low-margin' | 'no-speech')[]}
 */
export function signalQuality(metrics, noiseFloorDb = metrics.noiseFloorDb) {
  const speechSec = metrics.phonation.speechSec;
  const voicedShare = speechSec > 0 ? metrics.pitch.voicedSec / speechSec : null;
  const p90 = metrics.loudness.p90Db;
  const marginDb = p90 === null || p90 === undefined || noiseFloorDb === null ? null : p90 - noiseFloorDb;

  const reasons = [];
  if (voicedShare === null) reasons.push('no-speech');
  else if (voicedShare < MIN_VOICED_SHARE) reasons.push('noise-as-speech');
  if (marginDb !== null && marginDb < MIN_MARGIN_DB) reasons.push('low-margin');

  const round = (v) => (v === null ? null : Math.round(v * 100) / 100);
  return { reliable: reasons.length === 0, voicedShare: round(voicedShare), marginDb: round(marginDb), reasons };
}
