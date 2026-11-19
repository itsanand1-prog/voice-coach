// Small numeric helpers shared by the metrics code.

/** p-th percentile (0-100) with linear interpolation between ranks; null for empty input. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export function median(values) {
  return percentile(values, 50);
}

/** Interval from fromHz up to toHz in semitones (negative if toHz is lower). */
export function semitones(toHz, fromHz) {
  return 12 * Math.log2(toHz / fromHz);
}
