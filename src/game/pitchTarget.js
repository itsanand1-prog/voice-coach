// Pitch target: proposed from the user's own measured baseline, for the user to approve.
// Safety source: Hausman, "How to Develop a Powerful, Clear and Resonant Speaking Voice", ch. 4:
// lower by about a third, never more than a fifth, never force the voice into an artificially low
// range. This app stops at the conservative end (a minor third, 3 semitones) and goes one semitone
// at a time.

import { median } from '../dsp/stats.js';
import { BASELINE_SESSIONS } from './progress.js';

export const MAX_STEPS_DOWN = 3; // semitones below baseline, total
const BAND_HALF_WIDTH_ST = 3; // about the width of a natural speaking range

/** Median of the first five sessions' median pitch; null until there are five. */
export function baselineMedianHz(sessionMediansHz) {
  if (sessionMediansHz.length < BASELINE_SESSIONS) return null;
  return median(sessionMediansHz.slice(0, BASELINE_SESSIONS));
}

export function proposeBand(baselineHz, stepsDown) {
  const steps = Math.min(MAX_STEPS_DOWN, Math.max(0, stepsDown));
  const centerHz = baselineHz / 2 ** (steps / 12);
  const half = 2 ** (BAND_HALF_WIDTH_ST / 12);
  return { centerHz, lowHz: centerHz / half, highHz: centerHz * half, semitonesBelowBaseline: steps };
}
