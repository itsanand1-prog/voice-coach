// What the live display and cues need, from the most recent stretch of the frame track.

import { summarize, DEFAULTS } from '../summary.js';
import { sliceTrack } from '../track.js';
import { HARD_ONSET_MS } from '../game/technique.js';

const MIN_SPEECH_FOR_RATE_SEC = 3;
const MAX_LOOKBACK_SEC = 60;
const MIN_SPEECH_FOR_FLOW_SEC = 1;

/**
 * @param track frame track so far
 * @param o.thresholdDb speech threshold for the session so far (null = no speech yet)
 * @param o.windowSec how far back rate, pitch and onsets look (default 15 s)
 */
export function liveSnapshot(track, { thresholdDb, windowSec = 15 }) {
  const empty = { rateSpm: null, flow: null, breathGroupSec: 0, hardOnsetStreak: 0, secSinceLastOnset: null, lastOnsetMs: null, recentPitchHz: null };
  if (thresholdDb === null || thresholdDb === undefined) return empty;

  const n = track.db.length;
  const from = Math.max(0, n - Math.round(windowSec / track.frameSec));
  const m = summarize(sliceTrack(track, from, n), { speechThresholdDb: thresholdDb });

  let hardOnsetStreak = 0;
  for (let i = m.onsets.riseMs.length - 1; i >= 0 && m.onsets.riseMs[i] < HARD_ONSET_MS; i--) hardOnsetStreak++;
  const lastOnset = m.onsets.atSec[m.onsets.atSec.length - 1];

  return {
    rateSpm: m.phonation.speechSec >= MIN_SPEECH_FOR_RATE_SEC ? m.rate.programSpm : null,
    flow: m.phonation.speechSec >= MIN_SPEECH_FOR_FLOW_SEC ? m.phonation.flow : null,
    breathGroupSec: currentBreathGroupSec(track, thresholdDb),
    hardOnsetStreak,
    secSinceLastOnset: lastOnset === undefined ? null : m.durationSec - lastOnset,
    lastOnsetMs: m.onsets.riseMs.length ? m.onsets.riseMs[m.onsets.riseMs.length - 1] : null,
    recentPitchHz: m.pitch.medianHz,
  };
}

/** Length of the breath group still in progress at the end of the track; 0 during a pause. */
function currentBreathGroupSec(track, thresholdDb) {
  const { db, frameSec } = track;
  const pauseFrames = Math.round(DEFAULTS.pauseSec / frameSec);
  const stopAt = Math.max(0, db.length - Math.round(MAX_LOOKBACK_SEC / frameSec));
  let gap = 0;
  let start = -1;
  for (let i = db.length - 1; i >= stopAt; i--) {
    if (db[i] >= thresholdDb) {
      start = i;
      gap = 0;
    } else if (++gap >= pauseFrames) {
      break;
    }
  }
  return start < 0 ? 0 : (db.length - start) * frameSec;
}
