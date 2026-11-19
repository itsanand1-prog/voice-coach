// Karaoke pacer: moves a highlight through syllable-marked text at the target rate.
// Text marks syllable breaks with a middle dot ("vil·lage"); words are separated by spaces.
// Each syllable gets one beat, so the highlight fills each syllable over its whole beat:
// that is what stretched (prolonged) speech at the target rate looks like.

export const COUNT_IN_SEC = 3;
const MARK = '·';

/** "The vil·lage" -> {words: [{syllables: ['The']}, {syllables: ['vil', 'lage']}], count, text} */
export function parseLine(line) {
  const words = line
    .split(' ')
    .filter(Boolean)
    .map((w) => ({ syllables: w.split(MARK) }));
  return {
    words,
    count: words.reduce((n, w) => n + w.syllables.length, 0),
    text: line.split(MARK).join(''),
  };
}

/**
 * @param lines      syllable-marked lines
 * @param spm        target syllables per minute
 * @param pauseBeats breath pause after each line, in beats
 * @returns {beatSec, totalSec, syllables: [{line, word, syl, start, end}], pauses: [{line, start, end}]}
 *
 * The programme counts ordinary pauses in its stopwatch time, so the beat is shortened slightly
 * to make syllables / (syllables + pauses) come out at exactly the target rate.
 */
export function buildSchedule(lines, spm, { pauseBeats = 1 } = {}) {
  const parsed = lines.map(parseLine);
  const total = parsed.reduce((n, l) => n + l.count, 0);
  const beatSec = ((60 / spm) * total) / (total + pauseBeats * parsed.length);

  const syllables = [];
  const pauses = [];
  let t = 0;
  parsed.forEach((l, line) => {
    l.words.forEach((w, word) => {
      w.syllables.forEach((_, syl) => {
        syllables.push({ line, word, syl, start: t, end: t + beatSec });
        t += beatSec;
      });
    });
    pauses.push({ line, start: t, end: t + pauseBeats * beatSec });
    t += pauseBeats * beatSec;
  });
  return { beatSec, totalSec: t, syllables, pauses, lines: parsed };
}

/** Where the highlight is `t` seconds after the first syllable (negative t = counting in). */
export function positionAt(schedule, t) {
  if (t < 0) return { phase: 'countIn', secondsLeft: Math.ceil(-t - 1e-9) };
  if (t >= schedule.totalSec) return { phase: 'done' };
  const { syllables, pauses, beatSec } = schedule;
  for (const p of pauses) {
    if (t >= p.start && t < p.end) return { phase: 'pause', line: p.line, frac: (t - p.start) / (p.end - p.start) };
  }
  // Syllables are evenly spaced within a line; find the last one starting at or before t.
  let lo = 0;
  let hi = syllables.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (syllables[mid].start <= t + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  const s = syllables[lo];
  return { phase: 'syllable', index: lo, line: s.line, frac: Math.min(1, Math.max(0, (t - s.start) / beatSec)) };
}
