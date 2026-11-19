// Practice app controller: home, guided session with live cues, review, results.

import { startMic, startSynthetic } from '../audio/capture.js';
import { summarize, sessionThreshold } from '../summary.js';
import { sliceTrack } from '../track.js';
import { findRepetitions } from '../repetition.js';
import { liveSnapshot } from '../live/snapshot.js';
import { pickCue, CUES, CUE_DEFAULTS } from '../live/cues.js';
import { SEGMENTS, segmentById } from '../session/template.js';
import { LADDER_SPM, MIN_FLOW, PASSES_TO_ADVANCE } from '../session/ladder.js';
import { buildRecord } from '../session/record.js';
import { reviewCandidates, countAnswers, selectForReview } from '../session/review.js';
import { MIN_DRIFT_PARTS } from '../session/drift.js';
import { initialState, applySession, rebuildState, RULES_VERSION, levelForXp, xpForLevel, BADGES, BASELINE_SESSIONS } from '../game/progress.js';
import { weekStart, generateWeeklyGoals, goalProgress } from '../game/goals.js';
import { baselineMedianHz, proposeBand, MAX_STEPS_DOWN } from '../game/pitchTarget.js';
import { HARD_ONSET_MS, SOFT_ONSET_MS } from '../game/technique.js';
import * as store from '../store.js';
import { buildExport, exportFileName, parseExport, mergeSessions } from '../export.js';
import { registerServiceWorker } from '../sw-register.js';

registerServiceWorker();
import * as text from '../content/prompts.js';
import { createKaraoke } from './karaoke-view.js';

// ---- Settings left to the builder (listed in README) ----
const DAILY_LOAD_LIMIT_SEC = 30 * 60; // placeholder safety default, to be verified
const DEFAULT_BREATH_GOAL_SEC = 2; // until the user's own baseline exists
const TRACE_SEC = 10;
const TICK_MS = 250;
const CUE_SHOW_SEC = 3;

// Demo mode: ?demo=1 uses a synthetic voice; &speed=N shortens every segment N times.
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const TIME_SCALE = Math.max(1, Number(params.get('speed')) || 1);
if (DEMO) store.useDatabase('voice-coach-demo');

const $ = (id) => document.getElementById(id);
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
const fmt = (v, digits = 0, unit = '') => (v === null || v === undefined ? '–' : `${v.toFixed(digits)}${unit}`);
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

let state = initialState();
let sessions = [];
let live = null; // the session in progress
let lastRecord = null;
// Opt-in tuning aid, like the bench page's: level, pitch and band energies per 10 ms plus where
// each part began. Not audio. Kept only until "Done" is pressed on the results screen.
let lastTuning = null;

function show(view) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === `view-${view}`);
  window.scrollTo(0, 0);
}

function currentBand() {
  const baseline = baselineMedianHz(state.baselineHz);
  return baseline !== null && state.pitchStepsDown !== null ? proposeBand(baseline, state.pitchStepsDown) : null;
}

function breathGoalSec() {
  const b = state.baselineBreathSec;
  return b.length >= BASELINE_SESSIONS ? 1.25 * (b.reduce((a, x) => a + x, 0) / b.length) : DEFAULT_BREATH_GOAL_SEC;
}

async function persist() {
  try {
    await store.saveState(state);
  } catch (err) {
    console.error('Could not save progress', err);
  }
}

// =====================================================================
// Home
// =====================================================================

function renderHome() {
  const level = levelForXp(state.xp);
  $('level-line').textContent = `Level ${level}`;
  $('stat-streak').textContent = `${state.streak.current} ${state.streak.current === 1 ? 'day' : 'days'}`;
  $('stat-freezes').textContent = String(state.streak.freezes);
  $('stat-sessions').textContent = String(state.sessions);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  $('xp-bar').max = next - base;
  $('xp-bar').value = state.xp - base;
  $('xp-text').textContent = `${state.xp} XP · ${next - state.xp} to level ${level + 1}`;

  $('demo-banner').textContent = DEMO
    ? `Demo mode: a synthetic voice replaces the microphone${TIME_SCALE > 1 ? ` and each part is ${TIME_SCALE}× shorter` : ''}. Demo progress is kept apart from your real progress.`
    : '';

  const target = LADDER_SPM[state.ladder.step];
  $('ladder-line').textContent = `Reading target: ${target} syllables/min (step ${state.ladder.step + 1} of ${LADDER_SPM.length}, ${state.ladder.passes} of ${PASSES_TO_ADVANCE} blocks passed).`;

  $('segment-list').replaceChildren(
    ...SEGMENTS.filter((s) => !s.optional).map((s) => el('li', {}, el('span', { textContent: s.title }), el('span', { textContent: `${s.minutes} min` }))),
  );

  const todaySec = sessions.filter((r) => r.day === today()).reduce((sum, r) => sum + r.durationSec, 0);
  $('load-note').textContent =
    todaySec >= DAILY_LOAD_LIMIT_SEC
      ? `You have practised ${Math.round(todaySec / 60)} minutes today. Rest your voice now; more practice today adds strain, not skill. You can still start if you choose to.`
      : '';
  $('start-session').textContent = todaySec >= DAILY_LOAD_LIMIT_SEC ? 'Practise anyway' : 'Start session';

  renderGoals();
  renderBests();
  renderBadges();
  renderSettings();
}

function renderGoals() {
  const thisMonday = weekStart(today());
  const lastMonday = addDays(thisMonday, -7);
  const inWeek = (monday) => sessions.filter((r) => weekStart(r.day) === monday);
  const progress = goalProgress(generateWeeklyGoals(inWeek(lastMonday)), inWeek(thisMonday));
  const show = (g, v) => {
    if (v === null) return '–';
    if (g.id === 'practiceDays') return String(v);
    if (g.id === 'softOnsetShare') return `${Math.round(v * 100)}%`;
    return `${v.toFixed(1)} s`;
  };
  $('goals').replaceChildren(
    ...progress.map((g) => {
      const ratio = g.value === null ? 0 : Math.min(1, g.value / g.target);
      return el(
        'div',
        { className: `goal${g.met ? ' met' : ''}` },
        el('div', { className: 'row' }, el('span', { textContent: g.label }), el('strong', { textContent: `${show(g, g.value)} / ${show(g, g.target)}${g.met ? ' ✓' : ''}` })),
        el('progress', { max: 1, value: ratio, ariaLabel: g.label }),
      );
    }),
  );
}

function renderBests() {
  const b = state.bests;
  const rows = [
    ['Longest breath group', fmt(b.longestBreathGroupSec, 1, ' s')],
    ['Steadiest session (start vs end of each part)', b.driftScore === null ? 'needs a full session' : `${b.driftScore} / 100`],
    ['Best streak', `${b.streak} ${b.streak === 1 ? 'day' : 'days'}`],
  ];
  $('bests').replaceChildren(...rows.map(([k, v]) => el('li', { className: 'row spread' }, el('span', { textContent: k }), el('strong', { textContent: v }))));
}

function renderBadges() {
  $('badges').replaceChildren(
    ...BADGES.map((b) => {
      const earned = state.badges[b.id];
      return el(
        'div',
        { className: `badge ${earned ? 'earned' : 'locked'}` },
        el('strong', { textContent: b.name }),
        el('span', { textContent: earned ? `Earned ${earned}` : b.how }),
      );
    }),
  );
}

function renderSettings() {
  const select = $('ladder-step');
  select.replaceChildren(...LADDER_SPM.map((spm, i) => el('option', { value: String(i), textContent: `Step ${i + 1}: ${spm} syllables/min` })));
  select.value = String(state.ladder.step);

  const panel = $('pitch-panel');
  const baseline = baselineMedianHz(state.baselineHz);
  if (baseline === null) {
    panel.replaceChildren(
      el('p', { textContent: `Measuring your baseline: ${state.baselineHz.length} of ${BASELINE_SESSIONS} sessions recorded. No pitch target is set or cued until you approve one.` }),
    );
    return;
  }
  const band = currentBand();
  const steps = state.pitchStepsDown;
  const describe = (b) => `${b.lowHz.toFixed(0)}–${b.highHz.toFixed(0)} Hz (centre ${b.centerHz.toFixed(0)} Hz)`;
  const nodes = [
    el('p', { textContent: `Your baseline median pitch is ${baseline.toFixed(0)} Hz.` }),
    el('p', {
      textContent: band
        ? `Approved band: ${describe(band)}, ${steps} semitone${steps === 1 ? '' : 's'} below baseline.`
        : 'No pitch band approved yet.',
    }),
  ];
  const buttons = el('div', { className: 'row' });
  const setSteps = async (n) => {
    state.pitchStepsDown = n;
    await persist();
    renderHome();
  };
  if (!band) {
    buttons.append(el('button', { textContent: `Approve band at baseline: ${describe(proposeBand(baseline, 0))}`, onclick: () => setSteps(0) }));
  } else {
    if (steps < MAX_STEPS_DOWN) {
      buttons.append(el('button', { textContent: `Lower by 1 semitone: ${describe(proposeBand(baseline, steps + 1))}`, onclick: () => setSteps(steps + 1) }));
    }
    if (steps > 0) buttons.append(el('button', { textContent: 'Raise by 1 semitone', onclick: () => setSteps(steps - 1) }));
    buttons.append(el('button', { textContent: 'Remove band', onclick: () => setSteps(null) }));
  }
  nodes.push(buttons);
  nodes.push(
    el('p', {
      className: 'muted',
      textContent: `The band never goes more than ${MAX_STEPS_DOWN} semitones below your baseline. Lower it only if the current band feels easy; never press the voice down.`,
    }),
  );
  panel.replaceChildren(...nodes);
}

// =====================================================================
// Session
// =====================================================================

function demoVoice(ctx) {
  // Voice-like tone at 150 Hz: two "syllables" per second in 2-second phrases separated by
  // 2-second silences. Programme rate counts those short pauses, so it reads 60 syllables/min.
  // The silences matter: without them there is no room-noise floor and the quality check fails.
  const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 150 });
  const syllables = new GainNode(ctx, { gain: 0.165 });
  const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 2 });
  const depth = new GainNode(ctx, { gain: 0.135 });
  lfo.connect(depth).connect(syllables.gain);
  osc.connect(syllables);

  // Phrase gate: a slow square wave mapped from -1..1 to 0..1.
  const phrases = new GainNode(ctx, { gain: 0 });
  const gate = new OscillatorNode(ctx, { type: 'square', frequency: 0.25 });
  const half = new GainNode(ctx, { gain: 0.5 });
  const offset = new ConstantSourceNode(ctx, { offset: 0.5 });
  gate.connect(half).connect(phrases.gain);
  offset.connect(phrases.gain);
  syllables.connect(phrases);

  // Start the syllable wave 1/8 s after the gate so every phrase opens and closes in a dip
  // between syllables; cutting mid-syllable adds a partial syllable at each edge.
  const t0 = ctx.currentTime + 0.05;
  for (const node of [osc, gate, offset]) node.start(t0);
  lfo.start(t0 + 0.125);
  return phrases;
}

async function startSession() {
  $('start-session').disabled = true;
  let capture;
  try {
    capture = DEMO ? await startSynthetic(demoVoice, () => {}) : await startMic(() => {});
  } catch (err) {
    $('start-session').disabled = false;
    $('load-note').textContent = `Could not start the microphone: ${err.message}`;
    return;
  }
  $('start-session').disabled = false;

  live = {
    capture,
    startedAt: new Date().toISOString(),
    day: today(),
    plan: SEGMENTS.filter((s) => !s.optional || $('include-drill').checked),
    index: -1,
    run: null,
    runs: [],
    marks: [],
    lastCueAtSec: -1e9,
    cueShownAtSec: -1e9,
    thresholdDb: null,
    ticks: 0,
    timer: null,
    stoppedForSafety: false,
    micProcessing: capture.warnings.length ? Object.keys(capture.applied).filter((k) => ['echoCancellation', 'noiseSuppression', 'autoGainControl'].includes(k) && capture.applied[k] === true) : [],
    contentIndex: 0,
    wakeLock: null,
    band: currentBand(),
    targetSpm: LADDER_SPM[state.ladder.step],
  };
  try {
    live.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // Screen wake lock is a convenience; the session works without it.
  }
  const PROCESSING_NAMES = { echoCancellation: 'echo cancellation', noiseSuppression: 'noise suppression', autoGainControl: 'automatic volume' };
  $('mic-warning').textContent = live.micProcessing.length
    ? `This device kept ${live.micProcessing.map((k) => PROCESSING_NAMES[k]).join(' and ')} switched on, so loudness and soft-start readings may be less accurate here. Pitch and flow are not affected.`
    : '';
  live.timer = setInterval(tick, TICK_MS);
  beginSegment(0);
}

const nowSec = () => live.capture.track.db.length * live.capture.track.frameSec;

function beginSegment(index) {
  stopKaraoke();
  live.index = index;
  const def = live.plan[index];
  live.run = { id: def.id, from: live.capture.track.db.length, plannedSec: (def.minutes * 60) / TIME_SCALE, startedMs: performance.now() };
  live.contentIndex = 0;

  $('seg-progress').textContent = `Part ${index + 1} of ${live.plan.length}`;
  $('seg-title').textContent = def.title;
  $('seg-intro').textContent = def.rateTarget ? `${def.intro} Target: ${live.targetSpm} syllables/min.` : def.intro;
  $('seg-timer').textContent = clock(live.run.plannedSec);
  $('live-panel').style.display = def.kind === 'speech' ? 'grid' : 'none';
  $('cue').textContent = '';
  $('cue').classList.remove('on');


  // Paced parts show how continuously the voice flows (the pacer sets the rate);
  // free-speech parts show the rate, which the counter measures well on normal speech.
  const zone = $('rate-zone');
  $('rate-label').textContent = def.rateTarget ? 'Sound flowing' : 'Rate (syll/min)';
  if (def.rateTarget) {
    zone.style.display = '';
    zone.style.left = `${MIN_FLOW * 100}%`;
    zone.style.width = `${100 - MIN_FLOW * 100}%`;
  } else {
    zone.style.display = 'none';
  }

  renderContent();
  show('session');
}

const RATE_GAUGE_MAX = 300;
const ratePct = (spm) => Math.min(100, Math.max(0, (100 * spm) / RATE_GAUGE_MAX));

let karaoke = null;

function stopKaraoke() {
  karaoke?.stop();
  karaoke = null;
  $('content-restart').style.display = 'none';
}

/** Breath phrases and reading run on the karaoke pacer at the ladder rate. */
function startKaraoke(lines, { pauseBeats, single, onDone }) {
  stopKaraoke();
  karaoke = createKaraoke({ box: $('seg-content'), status: $('k-status'), lines, spm: live.targetSpm, pauseBeats, single, onDone });
  karaoke.start();
  $('content-next').textContent = 'Pause';
  $('content-restart').style.display = '';
}

function renderContent() {
  const def = live.plan[live.index];
  const box = $('seg-content');
  const next = $('content-next');
  const n = state.sessions + live.contentIndex;
  const steps = (list) => list.map((s) => el('div', { className: 'step' }, el('strong', { textContent: s.title }), s.text));
  next.style.display = '';
  stopKaraoke();

  switch (def.content) {
    case 'warmup':
      box.replaceChildren(...steps(text.WARMUP_STEPS));
      next.style.display = 'none';
      break;
    case 'drill':
      box.replaceChildren(...steps(text.DRILL_STEPS));
      next.style.display = 'none';
      break;
    case 'phrases': {
      // Every phrase in turn, starting where the last session left off; two beats to breathe between.
      const start = n % text.PHRASES.length;
      const phrases = [...text.PHRASES.slice(start), ...text.PHRASES.slice(0, start)];
      startKaraoke(phrases, { pauseBeats: 2, single: true, onDone: renderContent });
      break;
    }
    case 'reading':
      startKaraoke(text.rotate(text.READING_PASSAGES, n), {
        pauseBeats: 1,
        single: false,
        onDone: () => {
          live.contentIndex++;
          renderContent();
        },
      });
      break;
    case 'monologue':
      box.replaceChildren(el('p', { textContent: text.rotate(text.MONOLOGUES, n) }));
      next.textContent = 'Different scenario';
      break;
    case 'topic':
      box.replaceChildren(el('p', { textContent: text.rotate(text.TOPICS, n) }));
      next.textContent = 'Different topic';
      break;
    case 'phone': {
      const call = text.rotate(text.PHONE_CALLS, state.sessions);
      const line = call.lines[live.contentIndex % call.lines.length];
      box.replaceChildren(el('p', { className: 'caller', textContent: `${call.title} · the other person says:` }), el('p', { textContent: `“${line}”` }));
      next.textContent = 'Next line';
      break;
    }
    default:
      box.replaceChildren();
  }
}

function tick() {
  if (!live || !live.run) return;
  const def = live.plan[live.index];
  const elapsed = (performance.now() - live.run.startedMs) / 1000;
  const remaining = live.run.plannedSec - elapsed;
  $('seg-timer').textContent = clock(Math.max(0, remaining));
  if (remaining <= 0) {
    endSegment();
    return;
  }
  if (def.kind !== 'speech') return;

  const track = live.capture.track;
  if (live.ticks++ % 4 === 0) live.thresholdDb = sessionThreshold(track);
  const snap = liveSnapshot(track, { thresholdDb: live.thresholdDb });
  renderGauges(snap);
  drawTrace(track);

  const now = nowSec();
  const cue = pickCue(snap, { paced: Boolean(def.rateTarget), band: live.band }, { nowSec: now, lastCueAtSec: live.lastCueAtSec, lastFlowCueAtSec: live.lastFlowCueAtSec });
  if (cue) {
    live.lastCueAtSec = now;
    if (cue === 'flow') live.lastFlowCueAtSec = now;
    live.cueShownAtSec = now;
    $('cue').textContent = CUES[cue].text;
    $('cue').classList.add('on');
    navigator.vibrate?.(80);
  } else if (now - live.cueShownAtSec > CUE_SHOW_SEC) {
    $('cue').textContent = '';
    $('cue').classList.remove('on');
  }
}

function renderGauges(snap) {
  const def = live.plan[live.index];
  if (def.rateTarget) {
    $('rate-value').textContent = snap.flow === null ? '–' : `${Math.round(snap.flow * 100)}%`;
    $('rate-marker').style.left = `${Math.round((snap.flow ?? 0) * 100)}%`;
  } else {
    $('rate-value').textContent = snap.rateSpm === null ? '–' : snap.rateSpm.toFixed(0);
    $('rate-marker').style.left = `${ratePct(snap.rateSpm ?? 0)}%`;
  }

  $('breath-value').textContent = `${snap.breathGroupSec.toFixed(1)} s`;
  const fill = $('breath-fill');
  fill.style.width = `${Math.min(100, (100 * snap.breathGroupSec) / CUE_DEFAULTS.breathLimitSec)}%`;
  fill.classList.toggle('over', snap.breathGroupSec > CUE_DEFAULTS.breathLimitSec);

  const ms = snap.lastOnsetMs;
  $('onset-value').textContent = ms === null ? '–' : ms >= SOFT_ONSET_MS ? 'Soft' : ms < HARD_ONSET_MS ? 'Hard' : 'Medium';
}

function drawTrace(track) {
  const canvas = $('trace');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const band = live.band;

  // Log-frequency axis: centred on the band if there is one, otherwise a wide speaking range.
  const lo = band ? band.lowHz / 2 ** (5 / 12) : 70;
  const hi = band ? band.highHz * 2 ** (5 / 12) : 350;
  const y = (hz) => h - (h * Math.log(hz / lo)) / Math.log(hi / lo);

  if (band) {
    g.fillStyle = css.getPropertyValue('--accent-soft');
    g.fillRect(0, y(band.highHz), w, y(band.lowHz) - y(band.highHz));
  }
  const frames = Math.round(TRACE_SEC / track.frameSec);
  const from = Math.max(0, track.f0.length - frames);
  g.fillStyle = css.getPropertyValue('--accent');
  for (let i = from; i < track.f0.length; i++) {
    const f = track.f0[i];
    if (f < lo || f > hi) continue;
    g.fillRect(((i - from) / frames) * w, y(f) - 1.5, 2, 3);
  }
}

function closeRun() {
  if (!live.run) return;
  live.runs.push({ id: live.run.id, from: live.run.from, to: live.capture.track.db.length, plannedSec: live.run.plannedSec });
  live.run = null;
}

function endSegment() {
  stopKaraoke();
  closeRun();
  const next = live.plan[live.index + 1];
  if (!next) {
    toReview();
    return;
  }
  $('rest-title').textContent = `Next: ${next.title}`;
  $('rest-text').textContent = `${next.minutes} minutes. Take a sip of water and a slow breath first. If your throat feels sore or tight, finish here; today still counts.`;
  show('rest');
}

function mark(type) {
  if (!live || !live.run) return;
  live.marks.push({ type, atSec: Math.round(nowSec() * 10) / 10 });
  const blocks = live.marks.filter((m) => m.type === 'block').length;
  const reps = live.marks.length - blocks;
  $('mark-note').textContent = `Marked: ${blocks} block${blocks === 1 ? '' : 's'}, ${reps} repetition${reps === 1 ? '' : 's'}. Marks never lower your score.`;
  navigator.vibrate?.(30);
  // A block puts you behind the pacer; pause it so you can deal with the block calmly.
  if (type === 'block' && karaoke && !karaoke.paused) {
    karaoke.pause();
    $('content-next').textContent = 'Resume';
  }
}

// =====================================================================
// Review and results
// =====================================================================

async function toReview() {
  stopKaraoke();
  closeRun();
  clearInterval(live.timer);
  await live.capture.stop();
  try {
    await live.wakeLock?.release();
  } catch {
    // already released
  }

  live.selfRating = null;
  for (const b of document.querySelectorAll('.ratings button')) b.setAttribute('aria-pressed', 'false');
  $('finish-review').disabled = true;
  $('review-note').textContent = live.stoppedForSafety
    ? 'You stopped to protect your voice. That was the right call, and today counts as a practice day. Rest, drink some water, and avoid whispering or clearing your throat.'
    : '';

  const track = live.capture.track;
  const thresholdDb = sessionThreshold(track);
  live.candidates = [];
  for (const run of live.runs) {
    const def = segmentById(run.id);
    if (def.kind !== 'speech' || thresholdDb === null) continue;
    const slice = sliceTrack(track, run.from, run.to);
    live.candidates.push(
      ...reviewCandidates(
        summarize(slice, { speechThresholdDb: thresholdDb }).blockCandidates,
        findRepetitions(slice, { speechThresholdDb: thresholdDb }),
        { part: def.title, offsetSec: run.from * track.frameSec },
      ),
    );
  }
  live.flaggedTotal = live.candidates.length;
  live.candidates = selectForReview(live.candidates);

  const blocks = live.marks.filter((m) => m.type === 'block').length;
  $('marks-summary').textContent =
    `You marked ${blocks} block${blocks === 1 ? '' : 's'} and ${live.marks.length - blocks} repetition${live.marks.length - blocks === 1 ? '' : 's'} yourself.` +
    (live.candidates.length
      ? ` The app also noticed the moments below${live.flaggedTotal > live.candidates.length ? ` (the likeliest ${live.candidates.length} of ${live.flaggedTotal}, from every part)` : ''}. Its guesses are often wrong, so say what each one was. Your answers are saved to help tune it.`
      : ' The app did not notice any others.');

  $('candidates').replaceChildren(
    ...live.candidates.map((c) => {
      const choices = [['block', 'Block'], ['repetition', 'Repeat'], ['neither', 'Neither']].map(([value, label]) => {
        const button = el('button', { textContent: label, ariaPressed: 'false' });
        button.onclick = () => {
          c.answer = value;
          for (const [other] of choices) other.setAttribute('aria-pressed', String(other === button));
        };
        return [button, value];
      });
      return el(
        'div',
        { className: 'cand' },
        el('span', { className: 'small', textContent: `${c.part}, ${clock(c.atSec)} · ${c.detail}` }),
        el('div', { className: 'yn', role: 'group', ariaLabel: 'What was this?' }, ...choices.map(([button]) => button)),
      );
    }),
  );
  show('review');
}

async function finishReview() {
  $('finish-review').disabled = true;
  const record = buildRecord({
    track: live.capture.track,
    startedAt: live.startedAt,
    day: live.day,
    runs: live.runs,
    marks: live.marks,
    selfRating: live.selfRating,
    ...countAnswers(live.candidates),
    reviewed: live.candidates.map(({ detail, ...measured }) => measured),
    flaggedTotal: live.flaggedTotal,
    ladderStep: state.ladder.step,
    targetBand: live.band ? { lowHz: live.band.lowHz, highHz: live.band.highHz } : null,
    breathGoalSec: breathGoalSec(),
    stoppedForSafety: live.stoppedForSafety,
    micProcessing: live.micProcessing,
  });
  const tr = live.capture.track;
  lastTuning = {
    schema: 1,
    startedAt: live.startedAt,
    targetSpm: live.targetSpm,
    runs: live.runs,
    frameSec: tr.frameSec,
    db: tr.db.map((v) => Math.round(v * 10) / 10),
    f0: tr.f0.map((v) => Math.round(v)),
    specBands: tr.specBands,
    spec: tr.spec.map((v) => Math.round(v)),
  };
  live = null; // the frame track is released here; only the record and the tuning copy remain

  const result = applySession(state, record);
  state = result.state;
  sessions.push(record);
  lastRecord = record;
  try {
    await store.addSession(record);
  } catch (err) {
    console.error('Could not save the session', err);
  }
  await persist();
  renderResult(record, result.events);
  show('result');
}

function renderResult(record, events) {
  const xp = events.find((e) => e.type === 'xp').amount;
  $('result-xp').textContent = `+${xp} XP`;
  const q = record.quality;
  $('result-quality').textContent =
    q && !q.reliable
      ? q.reasons.includes('low-margin')
        ? 'Your voice was not far enough above the background noise to measure reliably today. The session counts as practice, but its measurements are not used for the rate ladder, your baseline or personal bests. A quieter room or sitting closer to the microphone will help.'
        : 'Background noise was being picked up as speech, so today’s measurements are not reliable. The session counts as practice, but its measurements are not used for the rate ladder, your baseline or personal bests. A quieter room or sitting closer to the microphone will help.'
      : '';

  const badgeName = (id) => BADGES.find((b) => b.id === id).name;
  const bestName = { longestBreathGroupSec: 'longest breath group', driftScore: 'steadiest session' };
  const lines = [];
  for (const e of events) {
    if (e.type === 'level') lines.push(`Level ${e.level} reached.`);
    if (e.type === 'badge') lines.push(`New badge: ${badgeName(e.id)}.`);
    if (e.type === 'best') lines.push(`New personal best: ${bestName[e.id]}.`);
    if (e.type === 'ladder') lines.push(`Rate ladder: moved up to ${LADDER_SPM[e.step]} syllables/min.`);
    if (e.type === 'freezeEarned') lines.push('Streak freeze earned.');
    if (e.type === 'freezeUsed') lines.push(`Streak kept with ${e.count} freeze${e.count === 1 ? '' : 's'}.`);
  }
  lines.push(`Streak: ${state.streak.current} ${state.streak.current === 1 ? 'day' : 'days'}.`);
  $('result-events').replaceChildren(...lines.map((t) => el('li', { textContent: t })));

  $('result-segments').replaceChildren(
    ...record.segments.map((s) =>
      el(
        'tr',
        {},
        el('th', { scope: 'row', textContent: segmentById(s.id).title }),
        el('td', { textContent: s.completed ? 'Done' : 'Part done' }),
        el('td', { textContent: s.technique === null ? '–' : `${s.technique} / 100` }),
        el('td', { textContent: segmentById(s.id).kind === 'speech' ? fmt(s.metrics.rate.programSpm, 0) : '–' }),
      ),
    ),
  );
  $('result-rating').textContent =
    record.selfRating === null
      ? ''
      : record.ratingClose === null
        ? `You rated your technique ${record.selfRating} of 5.`
        : record.ratingClose
          ? `You rated your technique ${record.selfRating} of 5, which matches what was measured in the reading.`
          : `You rated your technique ${record.selfRating} of 5; the reading measured differently. Compare the two next time, since judging your own technique is part of the skill.`;

  const lb = record.ladderBlock;
  const tick = (ok) => (ok ? '✓' : '·');
  $('result-ladder').replaceChildren(
    ...(lb
      ? [
          el('li', { textContent: `${tick(lb.flowOk)} Voice kept flowing ${record.readingFlow === null ? '–' : Math.round(record.readingFlow * 100) + '%'} of the time with the pacer (aim ${MIN_FLOW * 100}% or more)` }),
          el('li', { textContent: `${tick(lb.skillsOk)} Soft starts used on most phrases` }),
          el('li', { textContent: `${tick(lb.ratingOk)} Your own rating matched the measurement` }),
          el('li', { textContent: lb.pass ? `Block passed: ${state.ladder.passes} of ${PASSES_TO_ADVANCE} at the current step.` : 'Not counted this time. Nothing is lost; the next reading is a fresh block.' }),
        ]
      : [el('li', { textContent: 'The reading part was not completed, so no block was counted.' })]),
  );

  const d = record.metrics.drift;
  const enough = d && d.method === 'within-parts' && d.parts >= MIN_DRIFT_PARTS;
  const row = (label, e, digits, unit) => el('li', { textContent: `${label}: ${fmt(e.first, digits, unit)} → ${fmt(e.last, digits, unit)}` });
  $('result-drift').replaceChildren(
    ...(enough
      ? [
          el('li', { className: 'muted small', textContent: `Each speaking part compared with itself, first half against second half, averaged over ${d.parts} parts. Different parts ask for different rates, so they are not compared with each other.` }),
          row('Rate while speaking', d.articulationSpm, 0, ' syll/min'),
          row('Average breath group', d.breathGroupMeanSec, 1, ' s'),
          row('Median pitch', d.pitchMedianHz, 0, ' Hz'),
        ]
      : [el('li', { className: 'muted small', textContent: `Needs at least ${MIN_DRIFT_PARTS} speaking parts with enough speech.` })]),
  );
}

function exportTuning() {
  if (!lastTuning) return;
  const blob = new Blob([JSON.stringify(lastTuning)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `voice-session-track-${lastTuning.startedAt.slice(0, 19).replace(/[:T]/g, '-')}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportRecord() {
  const blob = new Blob([JSON.stringify(lastRecord, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `voice-session-${lastRecord.startedAt.slice(0, 19).replace(/[:T]/g, '-')}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}

// =====================================================================
// Wiring
// =====================================================================

$('start-session').addEventListener('click', startSession);
$('content-next').addEventListener('click', () => {
  if (karaoke) {
    if (karaoke.paused) karaoke.resume();
    else karaoke.pause();
    $('content-next').textContent = karaoke.paused ? 'Resume' : 'Pause';
    return;
  }
  live.contentIndex++;
  renderContent();
});
$('content-restart').addEventListener('click', () => renderContent());
$('mark-block').addEventListener('click', () => mark('block'));
$('mark-rep').addEventListener('click', () => mark('repetition'));
$('skip-seg').addEventListener('click', endSegment);
$('end-session').addEventListener('click', toReview);
$('stop-safety').addEventListener('click', () => {
  live.stoppedForSafety = true;
  toReview();
});
$('rest-continue').addEventListener('click', () => beginSegment(live.index + 1));
$('rest-finish').addEventListener('click', toReview);
for (const b of document.querySelectorAll('.ratings button')) {
  b.addEventListener('click', () => {
    live.selfRating = Number(b.dataset.v);
    for (const other of document.querySelectorAll('.ratings button')) other.setAttribute('aria-pressed', String(other === b));
    $('finish-review').disabled = false;
  });
}
$('finish-review').addEventListener('click', finishReview);
$('export-record').addEventListener('click', exportRecord);
$('export-tuning').addEventListener('click', exportTuning);
$('result-done').addEventListener('click', () => {
  lastTuning = null;
  renderHome();
  show('home');
});
$('ladder-step').addEventListener('change', async (e) => {
  state.ladder = { step: Number(e.target.value), passes: 0 };
  await persist();
  renderHome();
});

// =====================================================================
// Backup, moving devices, install
// =====================================================================

/** Opens the share menu where the browser can share files (phones), otherwise downloads. */
async function shareOrDownload(name, data) {
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Voice Coach export' });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  const a = el('a', { href: URL.createObjectURL(file), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
  return 'downloaded';
}

async function exportSessions(onlyNew) {
  const data = buildExport(sessions, state, { since: onlyNew ? state.lastExportAt : null });
  const status = $('export-status');
  if (data.sessions.length === 0) {
    status.textContent = 'No new sessions since your last export.';
    return;
  }
  const outcome = await shareOrDownload(exportFileName(), data);
  if (outcome === 'cancelled') {
    status.textContent = 'Export cancelled.';
    return;
  }
  state.lastExportAt = data.sessions[data.sessions.length - 1].startedAt;
  await persist();
  const n = data.sessions.length;
  status.textContent = `${n} session${n === 1 ? '' : 's'} ${outcome === 'shared' ? 'shared' : 'saved to your downloads; upload the file to Drive'}.`;
}

async function importFile(file) {
  const status = $('import-status');
  try {
    const { sessions: incoming } = parseExport(await file.text());
    const { merged, added } = mergeSessions(sessions, incoming);
    for (const s of added) await store.addSession(s);
    sessions = merged;
    state = rebuildState(state, sessions);
    await persist();
    renderHome();
    const skipped = incoming.length - added.length;
    status.textContent = `Added ${added.length} session${added.length === 1 ? '' : 's'}${skipped ? `; ${skipped} ${skipped === 1 ? 'was' : 'were'} already here` : ''}.`;
  } catch (err) {
    status.textContent = err.message;
  }
  $('import-file').value = '';
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('install-box').hidden = false;
});
$('install-app').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install-box').hidden = true;
});
$('export-new').addEventListener('click', () => exportSessions(true));
$('export-all').addEventListener('click', () => exportSessions(false));
$('import-file').addEventListener('change', (e) => e.target.files[0] && importFile(e.target.files[0]));

(async function init() {
  try {
    const saved = await store.loadState();
    sessions = await store.allSessions();
    state = { ...initialState(), ...(saved ?? {}) };
    // Scoring rules changed since this progress was saved: replay the stored sessions under
    // the current rules (XP and badges never go down).
    if (saved && saved.rulesVersion !== RULES_VERSION && sessions.length) {
      state = rebuildState(saved, sessions);
      await persist();
    }
  } catch (err) {
    console.error('Storage unavailable; progress will not persist', err);
  }
  renderHome();
})();
