// Builds the end-of-session "moments to check" list from the two proxies.
// Each entry carries the app's guess (kind) and the user's answer:
// 'block' | 'repetition' | 'neither' | null (not answered).

import { REPETITION_DEFAULTS } from '../repetition.js';

export const MAX_REVIEW = 12;
export const MIN_ATTEMPT_SEC = 0.06; // shorter "attempts" are ranked last: so far they were clicks

/**
 * A repetition ("th ... th ... the") also looks like short attempts followed by pauses, so the
 * block proxy fires on it as well. Such pauses are listed once, as the repetition.
 *
 * @param blocks       blockCandidates from summarize()
 * @param repetitions  findRepetitions() output
 * @param where        {part, offsetSec}: segment title and its start within the session
 */
export function reviewCandidates(blocks, repetitions, { part, offsetSec }) {
  const insideRepetition = (b) =>
    repetitions.some((r) => b.atSec >= r.atSec && b.atSec <= r.endSec + REPETITION_DEFAULTS.maxRepeatSec);

  const list = [
    ...blocks
      .filter((b) => !insideRepetition(b))
      .map((b) => ({
        kind: 'block',
        atSec: b.atSec,
        gapSec: b.gapSec,
        attemptSec: b.attemptSec,
        detail: `${b.gapSec.toFixed(1)} s pause after a short start`,
      })),
    ...repetitions.map((r) => ({
      kind: 'repetition',
      atSec: r.atSec,
      repeats: r.repeats, // extra attempts after the first, as the detector reports it
      detail: `same sound ${r.repeats + 1} times in a row`,
    })),
  ];
  return list
    .map((c) => ({ ...c, part, atSec: Math.round((offsetSec + c.atSec) * 100) / 100, answer: null }))
    .sort((a, b) => a.atSec - b.atSec);
}

/** Totals for the session record. The user's answer decides; the app's guess does not. */
export function countAnswers(candidates) {
  return {
    confirmedBlocks: candidates.filter((c) => c.answer === 'block').length,
    confirmedRepetitions: candidates.filter((c) => c.answer === 'repetition').length,
    repetitionCandidates: candidates.filter((c) => c.kind === 'repetition').length,
  };
}

/**
 * Pick which moments to show. Word-by-word speech can flag dozens of pauses, and showing the
 * first twelve by time meant later parts were never reviewed. Each part's moments are ranked
 * by how often that kind turned out real when reviewed in testing, and parts take turns
 * until the list is full. Nothing is dropped, only ordered.
 *
 * Reviewed in testing: same sound 3+ times 3/3 real, twice 0/5; blocks whose attempt lasted
 * 30-50 ms 0/5 real (likely clicks); a confirmed block had a 170 ms attempt.
 */
export function selectForReview(candidates, max = MAX_REVIEW) {
  const rank = (c) => {
    if (c.kind === 'repetition') return (c.repeats ?? 1) >= 2 ? 0 : 2;
    return (c.attemptSec ?? 0) >= MIN_ATTEMPT_SEC ? 1 : 3;
  };
  const byPart = new Map();
  for (const c of candidates) {
    if (!byPart.has(c.part)) byPart.set(c.part, []);
    byPart.get(c.part).push(c);
  }
  const queues = [...byPart.values()].map((list) => [...list].sort((a, b) => rank(a) - rank(b) || a.atSec - b.atSec));
  const shown = [];
  while (shown.length < max && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (q.length && shown.length < max) shown.push(q.shift());
    }
  }
  return shown.sort((a, b) => a.atSec - b.atSec);
}
