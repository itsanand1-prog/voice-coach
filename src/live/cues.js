// Rule-based live cues (DESIGN.md section 7). Pure: the caller shows text and vibrates.

export const CUES = {
  breathe: { text: 'Breathe' },
  softStart: { text: 'Soft start' },
  flow: { text: 'Keep sound flowing' },
  pitchUp: { text: 'Pitch drifting up' },
};

export const CUE_DEFAULTS = {
  breathLimitSec: 7, // one breath group longer than this prompts a breath
  hardOnsetStreak: 2, // hard onsets in a row before prompting
  onsetFreshSec: 3, // only prompt about onsets just after one
  minGapSec: 8, // quiet time between cues
  flowCueBelow: 0.6, // paced parts: prompt when the voice sounds less than this share of the time
  flowGapSec: 20, // the flow cue repeats at most this often: it would otherwise fire every 15-18 s
};

/**
 * @param snap  {flow, breathGroupSec, hardOnsetStreak, secSinceLastOnset, recentPitchHz}
 * @param cfg   {paced, band} plus optional overrides of CUE_DEFAULTS
 *
 * There is no rate cue: in paced parts the pacer sets the rate, and the syllable count doubles
 * on stretched speech, so "slow down" fired at people following the pacer correctly.
 * @param clock {nowSec, lastCueAtSec, lastFlowCueAtSec}
 * @returns cue id or null
 */
export function pickCue(snap, cfg, clock) {
  const c = { ...CUE_DEFAULTS, ...cfg };
  if (clock.nowSec - clock.lastCueAtSec < c.minGapSec) return null;

  if (snap.breathGroupSec > c.breathLimitSec) return 'breathe';
  if (
    snap.hardOnsetStreak >= c.hardOnsetStreak &&
    snap.secSinceLastOnset !== null &&
    snap.secSinceLastOnset <= c.onsetFreshSec
  ) {
    return 'softStart';
  }
  const flowRested = clock.nowSec - (clock.lastFlowCueAtSec ?? -Infinity) >= c.flowGapSec;
  if (c.paced && flowRested && snap.flow !== null && snap.flow !== undefined && snap.flow < c.flowCueBelow) return 'flow';
  if (c.band && snap.recentPitchHz !== null && snap.recentPitchHz > c.band.highHz) return 'pitchUp';
  return null;
}
