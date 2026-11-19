// Gamification state (DESIGN.md section 10). Pure functions over plain objects.
// Rule: rewards go to practice, technique, progress against own baseline and approaching
// feared situations. Nothing here reads how much stuttering occurred, and nothing is ever taken away.

import { recordBlock, MIN_FLOW } from '../session/ladder.js';
import { signalQuality } from '../session/quality.js';
import { MIN_DRIFT_PARTS, withinPartDrift } from '../session/drift.js';
import { segmentById } from '../session/template.js';

export const XP = { segment: 10, techniquePerTenPoints: 1, phone: 15, monologue: 10, drill: 5 };
export const BASELINE_SESSIONS = 5;
const MAX_FREEZES = 2;
export const RULES_VERSION = 4; // bump when scoring rules change; saved progress is then rebuilt

/** Measurements usable? Records saved before the check existed are judged from their stored metrics. */
function isReliable(record) {
  return (record.quality ?? signalQuality(record.metrics)).reliable;
}

export const BADGES = [
  { id: 'first-session', name: 'First Session', how: 'Finish your first practice session.' },
  { id: 'baseline-done', name: 'Baseline Done', how: 'Record five sessions so your own baseline is known.' },
  { id: 'streak-7', name: '7-Day Streak', how: 'Practise seven days in a row.' },
  { id: 'streak-30', name: '30-Day Streak', how: 'Practise thirty days in a row.' },
  { id: 'streak-100', name: '100-Day Streak', how: 'Practise one hundred days in a row.' },
  { id: 'soft-starter', name: 'Soft Starter', how: 'Make 70% of your starts soft in one session.' },
  { id: 'breath-master', name: 'Breath Master', how: 'Average breath group 25% longer than your baseline.' },
  { id: 'steady-pace', name: 'Steady Flow', how: 'Keep your voice flowing 70% of the time while reading with the pacer.' },
  { id: 'fatigue-fighter', name: 'Fatigue Fighter', how: 'Finish a full session as steady as you started.' },
  { id: 'deep-resonance', name: 'Deep Resonance', how: 'Spend 60% of voiced time in your approved pitch band.' },
  { id: 'phone-warrior', name: 'Phone Warrior', how: 'Complete five phone-call practices.' },
  { id: 'cancellation-champ', name: 'Cancellation Champ', how: 'Complete five block-modification drills.' },
  { id: 'ladder-step-up', name: 'Ladder Step Up', how: 'Move up a step on the rate ladder.' },
];

export function initialState() {
  return {
    schema: 1,
    rulesVersion: RULES_VERSION,
    xp: 0,
    sessions: 0,
    lifetimeSec: 0,
    streak: { current: 0, best: 0, lastDay: null, freezes: 0 },
    badges: {},
    bests: { longestBreathGroupSec: null, driftScore: null, streak: 0 },
    ladder: { step: 0, passes: 0 },
    counts: { phone: 0, drill: 0 },
    baselineHz: [],
    baselineBreathSec: [],
    pitchStepsDown: null, // null until the user approves a pitch band
    lastExportAt: null, // start time of the newest session in the last export
  };
}

function dayNumber(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function updateStreak(streak, day) {
  const next = { ...streak };
  let freezesUsed = 0;
  const gap = streak.lastDay === null ? null : dayNumber(day) - dayNumber(streak.lastDay);

  if (gap !== null && gap <= 0) return { streak: next, freezeEarned: false, freezesUsed };
  if (gap === null) {
    next.current = 1;
  } else if (gap === 1) {
    next.current = streak.current + 1;
  } else if (streak.freezes >= gap - 1) {
    freezesUsed = gap - 1;
    next.freezes = streak.freezes - freezesUsed;
    next.current = streak.current + 1;
  } else {
    next.current = 1;
  }
  next.lastDay = day;
  next.best = Math.max(streak.best, next.current);

  const freezeEarned = next.current % 7 === 0 && next.freezes < MAX_FREEZES;
  if (freezeEarned) next.freezes += 1;
  return { streak: next, freezeEarned, freezesUsed };
}

export function xpForSession(record) {
  const reliable = isReliable(record);
  let xp = 0;
  for (const s of record.segments) {
    if (!s.completed) continue;
    xp += XP.segment;
    if (reliable && s.technique !== null) xp += Math.round(s.technique / 10) * XP.techniquePerTenPoints;
    if (s.id === 'phone') xp += XP.phone;
    if (s.id === 'monologue') xp += XP.monologue;
    if (s.id === 'drill') xp += XP.drill;
  }
  return xp;
}

/**
 * Within-part drift for a record. Records saved before it existed hold a whole-session
 * comparison, but each speaking part's own drift is stored too, so it is rebuilt from those.
 */
function sessionDrift(record) {
  const d = record.metrics.drift;
  if (d?.method === 'within-parts') return d;
  const parts = (record.segments ?? [])
    .filter((s) => segmentById(s.id)?.kind === 'speech' && s.metrics?.drift && s.metrics?.phonation)
    .map((s) => ({ speechSec: s.metrics.phonation.speechSec, drift: s.metrics.drift }));
  return parts.length ? withinPartDrift(parts) : null;
}

/** Level L needs 100 * (L-1) * L / 2 XP: 100, 300, 600, 1000 ... */
export function levelForXp(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

export function xpForLevel(level) {
  return (100 * (level - 1) * level) / 2;
}

/**
 * 0-100: how steady speech stayed from the start to the end of each part (see session/drift.js).
 * Only deterioration counts (speeding up, shorter breath groups, rising pitch).
 * Whole-session drift saved by older versions compared different tasks, so it is not used.
 */
export function driftScore(drift) {
  if (!drift || drift.method !== 'within-parts' || drift.parts < MIN_DRIFT_PARTS) return null;
  const rel = (e) => (e && e.first && e.delta !== null ? e.delta / e.first : 0);
  const faster = Math.max(0, rel(drift.articulationSpm));
  const shorter = Math.max(0, -rel(drift.breathGroupMeanSec));
  const higher = Math.max(0, drift.pitchMedianHz?.deltaSemitones ?? 0);
  return Math.round(Math.max(0, 100 - 150 * faster - 100 * shorter - 15 * higher));
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function applySession(prev, record) {
  const state = structuredClone(prev);
  const events = [];

  const gained = xpForSession(record);
  const levelBefore = levelForXp(state.xp);
  state.xp += gained;
  state.sessions += 1;
  state.lifetimeSec += record.durationSec;
  events.push({ type: 'xp', amount: gained });
  if (levelForXp(state.xp) > levelBefore) events.push({ type: 'level', level: levelForXp(state.xp) });

  const streak = updateStreak(state.streak, record.day);
  state.streak = streak.streak;
  if (streak.freezesUsed) events.push({ type: 'freezeUsed', count: streak.freezesUsed });
  if (streak.freezeEarned) events.push({ type: 'freezeEarned' });

  const done = (id) => record.segments.some((s) => s.id === id && s.completed);
  if (done('phone')) state.counts.phone += 1;
  if (done('drill')) state.counts.drill += 1;

  // Everything below this point is judged from measurements, so it needs a trustworthy session.
  const reliable = isReliable(record);
  const breathMean = reliable ? record.metrics.breathGroups.meanSec : null;
  const breathGoalMet =
    state.baselineBreathSec.length >= BASELINE_SESSIONS &&
    breathMean !== null &&
    breathMean >= 1.25 * mean(state.baselineBreathSec);

  if (reliable && record.metrics.pitch.medianHz && state.baselineHz.length < BASELINE_SESSIONS) {
    state.baselineHz.push(record.metrics.pitch.medianHz);
    if (breathMean !== null) state.baselineBreathSec.push(breathMean);
  }

  let advanced = false;
  if (reliable && record.ladderBlock) {
    const r = recordBlock(state.ladder, record.ladderBlock.pass);
    state.ladder = r.ladder;
    advanced = r.advanced;
    if (advanced) events.push({ type: 'ladder', step: state.ladder.step });
  }

  const drift = reliable ? driftScore(sessionDrift(record)) : null;
  const best = (id, value) => {
    if (value === null || value === undefined) return;
    const old = state.bests[id];
    if (old === null || value > old) {
      state.bests[id] = value;
      if (old !== null) events.push({ type: 'best', id, value });
    }
  };
  best('longestBreathGroupSec', reliable ? record.metrics.breathGroups.maxSec : null);
  best('driftScore', drift);
  state.bests.streak = state.streak.best;

  const pct = reliable ? record.metrics.pitch.pctInBand : null;
  const earned = {
    'first-session': state.sessions >= 1,
    'baseline-done': state.baselineHz.length >= BASELINE_SESSIONS,
    'streak-7': state.streak.current >= 7,
    'streak-30': state.streak.current >= 30,
    'streak-100': state.streak.current >= 100,
    'soft-starter': reliable && record.softOnsetShare !== null && record.softOnsetShare >= 0.7 && record.onsetCount >= 10,
    'breath-master': breathGoalMet,
    'steady-pace': reliable && done('reading') && (record.readingFlow ?? null) !== null && record.readingFlow >= MIN_FLOW,
    'fatigue-fighter': drift !== null && drift >= 85,
    'deep-resonance': pct !== null && pct !== undefined && pct >= 60,
    'phone-warrior': state.counts.phone >= 5,
    'cancellation-champ': state.counts.drill >= 5,
    'ladder-step-up': advanced,
  };
  for (const { id } of BADGES) {
    if (earned[id] && !state.badges[id]) {
      state.badges[id] = record.day;
      events.push({ type: 'badge', id });
    }
  }

  return { state, events };
}

/**
 * Recompute progress by replaying every stored session under the current rules.
 * Choices the user made by hand (pitch steps, ladder step) are kept as saved, and
 * XP and badges never go down.
 */
export function rebuildState(saved, records) {
  const key = (r) => r.startedAt ?? r.day;
  let state = initialState();
  for (const record of [...records].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))) {
    state = applySession(state, record).state;
  }
  state.pitchStepsDown = saved.pitchStepsDown ?? null;
  state.lastExportAt = saved.lastExportAt ?? null;
  state.ladder = saved.ladder ? { ...saved.ladder } : state.ladder;
  // Nothing already earned is taken away: XP and badges only ever go up. Measurements
  // (baseline, personal bests) are replaced, since those are what the rebuild corrects.
  state.xp = Math.max(state.xp, saved.xp ?? 0);
  state.badges = { ...state.badges, ...(saved.badges ?? {}) };
  state.rulesVersion = RULES_VERSION;
  return state;
}
