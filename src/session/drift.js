// Fatigue drift that compares like with like.
// The session runs slow-rate parts first and free speech last, so "first five minutes against
// last five" measured the change of task, not fatigue. Instead, each speaking part is compared
// with itself (first half against second half) and the parts are averaged, weighted by how
// long each was spoken.

export const MIN_DRIFT_PARTS = 3;

const METRICS = ['articulationSpm', 'breathGroupMeanSec', 'pitchMedianHz'];

/**
 * @param parts [{speechSec, drift}] where drift is summarize(partTrack).drift
 * @returns drift in the same shape summarize() uses, plus {method: 'within-parts', parts}
 */
export function withinPartDrift(parts) {
  const usable = parts.filter(
    (p) => p.speechSec > 0 && METRICS.every((k) => p.drift[k].first !== null && p.drift[k].last !== null),
  );
  const weight = usable.reduce((n, p) => n + p.speechSec, 0);
  const avg = (pick) => (weight ? usable.reduce((n, p) => n + p.speechSec * pick(p), 0) / weight : null);
  const pair = (k) => {
    const first = avg((p) => p.drift[k].first);
    const last = avg((p) => p.drift[k].last);
    return { first, last, delta: first === null ? null : last - first };
  };
  return {
    method: 'within-parts',
    parts: usable.length,
    windowSec: avg((p) => p.drift.windowSec),
    articulationSpm: pair('articulationSpm'),
    breathGroupMeanSec: pair('breathGroupMeanSec'),
    pitchMedianHz: { ...pair('pitchMedianHz'), deltaSemitones: avg((p) => p.drift.pitchMedianHz.deltaSemitones) },
  };
}
