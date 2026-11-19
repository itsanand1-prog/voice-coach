// Technique-quality score: how well the practised skills were used.
// Inputs are skills only (onsets, flow with the pacer, phrasing). Stuttering counts are never an input.

import { MIN_FLOW } from '../session/ladder.js';

export const SOFT_ONSET_MS = 80; // rise time at or above this is a soft onset
export const HARD_ONSET_MS = 40; // rise time below this is a hard onset
const WEIGHTS = { onsets: 40, flow: 30, phrasing: 30 };

export function softOnsetShare(riseMs) {
  if (riseMs.length === 0) return null;
  return riseMs.filter((ms) => ms >= SOFT_ONSET_MS).length / riseMs.length;
}

/**
 * Returns {score: 0-100 or null, parts: each 0-1 or null when not measurable}.
 * @param flow share of time the voice kept sounding, in paced parts only (null elsewhere)
 */
export function techniqueScore({ riseMs, flow, breathGroupMeanSec, breathGoalSec }) {
  const parts = {
    onsets: softOnsetShare(riseMs),
    flow: flow === null || flow === undefined ? null : Math.min(1, flow / MIN_FLOW),
    phrasing: breathGroupMeanSec !== null && breathGoalSec ? Math.min(1, breathGroupMeanSec / breathGoalSec) : null,
  };
  let total = 0;
  let weight = 0;
  for (const key of Object.keys(WEIGHTS)) {
    if (parts[key] === null) continue;
    total += WEIGHTS[key] * parts[key];
    weight += WEIGHTS[key];
  }
  return { score: weight ? Math.round((100 * total) / weight) : null, parts };
}

export function ratingFromScore(score) {
  return Math.min(5, Math.max(1, Math.ceil(score / 20)));
}

/** Self-rating (1-5) agrees with the measurement when within one point. */
export function ratingClose(selfRating, score) {
  if (score === null || selfRating === null) return false;
  return Math.abs(selfRating - ratingFromScore(score)) <= 1;
}
