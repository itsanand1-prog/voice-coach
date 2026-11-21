// Turn a finished session (frame track + segment boundaries) into the stored record.
// The record holds metrics and marks only; the frame track is dropped here.

import { summarize } from '../summary.js';
import { sliceTrack, concatTracks } from '../track.js';
import { segmentById, isCompleted } from './template.js';
import { LADDER_SPM, evaluateBlock } from './ladder.js';
import { softOnsetShare, techniqueScore, ratingClose } from '../game/technique.js';
import { signalQuality } from './quality.js';
import { withinPartDrift } from './drift.js';

/** Drop per-onset arrays and round, so a record stays a few KB. */
function compact(metrics) {
  const { riseMs, atSec, ...onsets } = metrics.onsets;
  const slim = { ...metrics, onsets: { ...onsets, softShare: softOnsetShare(riseMs) } };
  return JSON.parse(JSON.stringify(slim, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
}

/**
 * @param s.track       whole-session frame track
 * @param s.runs        [{id, from, to, plannedSec}] frame ranges actually spent in each segment
 * @param s.marks       [{type: 'block' | 'repetition', atSec}] tap-to-mark events
 * @param s.repetitionCandidates, s.confirmedRepetitions, s.confirmedPauses  counts from the end-of-session review
 * @param s.reviewed    moments shown in the review, with what was measured and the user's answer
 * @param s.flaggedTotal  how many moments the detectors flagged before the review picked some
 * @param s.selfRating  1-5, given at session end
 * @param s.ladderStep  index into LADDER_SPM at the start of the session
 * @param s.targetBand  approved pitch band or null
 * @param s.breathGoalSec  breath-group length that earns full phrasing credit
 * @param s.micProcessing  voice processing the device would not switch off (e.g. 'autoGainControl')
 */
export function buildRecord(s) {
  const { track } = s;
  const capture = summarize(track);
  const thresholdDb = capture.speechThresholdDb;
  const options = { speechThresholdDb: thresholdDb, targetBand: s.targetBand };
  const targetSpm = LADDER_SPM[s.ladderStep];

  const speechSlices = [];
  const speechParts = [];
  let durationSec = 0;
  let reading = null;

  const segments = s.runs.map((run) => {
    const def = segmentById(run.id);
    const slice = sliceTrack(track, run.from, run.to);
    const sec = (run.to - run.from) * track.frameSec;
    durationSec += sec;
    const completed = isCompleted(run.plannedSec, sec);
    const metrics = summarize(slice, options);

    let technique = null;
    if (def.kind === 'speech') {
      speechSlices.push(slice);
      speechParts.push({ speechSec: metrics.phonation.speechSec, drift: metrics.drift });
      technique = techniqueScore({
        riseMs: metrics.onsets.riseMs,
        flow: def.rateTarget ? metrics.phonation.flow : null,
        breathGroupMeanSec: metrics.breathGroups.meanSec,
        breathGoalSec: s.breathGoalSec,
      }).score;
    }
    if (def.ladder) reading = { completed, metrics, technique };
    return { id: run.id, completed, sec: Math.round(sec), technique, metrics: compact(metrics) };
  });

  const whole = summarize(concatTracks(speechSlices), options);
  whole.drift = withinPartDrift(speechParts);
  const close = reading ? ratingClose(s.selfRating, reading.technique) : null;
  // Noise floor comes from the whole capture (rests and warm-up included), not just the speaking parts.
  const quality = signalQuality(whole, capture.noiseFloorDb);

  return {
    schema: 2,
    startedAt: s.startedAt,
    day: s.day,
    durationSec: Math.round(durationSec),
    segments,
    metrics: compact(whole),
    quality,
    softOnsetShare: softOnsetShare(whole.onsets.riseMs),
    onsetCount: whole.onsets.count,
    readingTargetSpm: targetSpm,
    readingSpm: reading ? reading.metrics.rate.programSpm : null, // unreliable on stretched speech; kept for reference
    readingFlow: reading ? reading.metrics.phonation.flow : null,
    ladderBlock:
      reading && reading.completed && quality.reliable
        ? evaluateBlock({
            flow: reading.metrics.phonation.flow,
            softOnsetShare: softOnsetShare(reading.metrics.onsets.riseMs),
            ratingClose: close,
          })
        : null,
    marks: s.marks,
    confirmedBlocks: s.confirmedBlocks,
    repetitionCandidates: s.repetitionCandidates ?? 0,
    confirmedRepetitions: s.confirmedRepetitions ?? 0,
    confirmedPauses: s.confirmedPauses ?? 0, // moments the user said were thinking pauses, not blocks
    reviewed: s.reviewed ?? [],
    flaggedTotal: s.flaggedTotal ?? (s.reviewed ?? []).length,
    selfRating: s.selfRating,
    ratingClose: close,
    targetBand: s.targetBand,
    stoppedForSafety: s.stoppedForSafety,
    micProcessing: s.micProcessing ?? [],
  };
}
