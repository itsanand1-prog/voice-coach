// Rate ladder for the reading segment.
// Steps follow the Boberg & Kully programme as summarised in Ward, "Stuttering and Cluttering",
// ch. 12: 60, 90, 120, 150, 190 syllables/min. The karaoke pacer holds the reader to the step's
// rate, so a block is judged on what the programme trains at that rate: stretched, linked speech
// with continuous airflow ("flow"), soft onsets, and accurate self-judgement. A syllable count
// cannot judge the rate here: on stretched speech it counted about twice the true number in testing.
// Deliberately NOT carried over: the programme's "100% fluency" criterion (design anti-goal:
// never reward stutter-free output) and repeating a failed block as a penalty.

export const LADDER_SPM = [60, 90, 120, 150, 190];
export const MIN_FLOW = 0.7; // voice sounding at least 70% of the time while reading with the pacer
export const MIN_SOFT_ONSET_SHARE = 0.6; // "fluency skills used"
export const PASSES_TO_ADVANCE = 3; // the programme asks for 3 to 5 blocks at each rate

export function evaluateBlock({ flow, softOnsetShare, ratingClose }) {
  const flowOk = flow !== null && flow !== undefined && flow >= MIN_FLOW;
  const skillsOk = softOnsetShare !== null && softOnsetShare >= MIN_SOFT_ONSET_SHARE;
  const ratingOk = ratingClose === true;
  return { pass: flowOk && skillsOk && ratingOk, flowOk, skillsOk, ratingOk };
}

/** Count a block. A failed block changes nothing; enough passes move up one step. */
export function recordBlock(ladder, pass) {
  if (!pass || ladder.step >= LADDER_SPM.length - 1) return { ladder: { ...ladder }, advanced: false };
  const passes = ladder.passes + 1;
  if (passes >= PASSES_TO_ADVANCE) return { ladder: { step: ladder.step + 1, passes: 0 }, advanced: true };
  return { ladder: { step: ladder.step, passes }, advanced: false };
}
