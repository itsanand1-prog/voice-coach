// Phase 1 bench UI: capture, live readout, session metrics, JSON export, acceptance self-test.

import { startMic, runSynthetic } from './audio/capture.js';
import { summarize } from './summary.js';
import { findRepetitions } from './repetition.js';
import { registerServiceWorker } from './sw-register.js';

registerServiceWorker();

const $ = (id) => document.getElementById(id);
const fmt = (v, digits = 1, unit = '') => (v === null || v === undefined ? '–' : `${v.toFixed(digits)}${unit}`);

let session = null; // {capture, startedAt, timer}
let lastExport = null;
let lastTrack = null;
let lastCaptureTrack = null; // kept only until the next session starts, for the metrics table

function targetBand() {
  const lowHz = parseFloat($('band-low').value);
  const highHz = parseFloat($('band-high').value);
  return lowHz > 0 && highHz > lowHz ? { lowHz, highHz } : null;
}

function renderLive(track) {
  const i = track.db.length - 1;
  $('live-f0').textContent = track.f0[i] > 0 ? `${track.f0[i].toFixed(0)} Hz` : '–';
  $('live-db').textContent = `${track.db[i].toFixed(0)} dB`;
  $('live-time').textContent = `${(track.db.length * track.frameSec).toFixed(0)} s`;
}

function row(label, value, driftEntry, digits = 1) {
  const drift = driftEntry
    ? `${fmt(driftEntry.first, digits)} → ${fmt(driftEntry.last, digits)}`
    : '';
  return `<tr><th scope="row">${label}</th><td>${value}</td><td>${drift}</td></tr>`;
}

function renderMetrics(m) {
  const d = m.drift;
  $('metrics').innerHTML =
    row('F0 median', fmt(m.pitch.medianHz, 1, ' Hz'), d.pitchMedianHz) +
    row('F0 range (10th–90th pct)', `${fmt(m.pitch.p10Hz, 0)}–${fmt(m.pitch.p90Hz, 0, ' Hz')} · ${fmt(m.pitch.rangeSemitones, 1, ' st')}`) +
    row('Time in target band', fmt(m.pitch.pctInBand, 0, ' %')) +
    row('Loudness median', fmt(m.loudness.medianDb, 1, ' dBFS'), d.loudnessMedianDb) +
    row('Room noise floor', fmt(m.noiseFloorDb, 1, ' dBFS')) +
    row('Onset rise time (median)', `${fmt(m.onsets.medianRiseMs, 0, ' ms')} · ${m.onsets.count} onsets`, d.onsetRiseMedianMs, 0) +
    row('Syllables detected', `${m.rate.syllables}`) +
    row('Articulation rate', fmt(m.rate.articulationSpm, 0, ' syll/min'), d.articulationSpm, 0) +
    row('Speech rate (incl. pauses)', fmt(m.rate.speechSpm, 0, ' syll/min')) +
    row('Phonation fraction', fmt(m.phonation.fraction === null ? null : m.phonation.fraction * 100, 0, ' %'), d.phonationFraction, 2) +
    row('Breath groups', `${m.breathGroups.count} · mean ${fmt(m.breathGroups.meanSec, 1, ' s')} · longest ${fmt(m.breathGroups.maxSec, 1, ' s')}`, d.breathGroupMeanSec) +
    row('Possible blocks (unconfirmed)', `${m.blockCandidates.length}`, d.blockCandidates, 0) +
    row('Possible repetitions (unconfirmed)', `${findRepetitions(session ? session.capture.track : lastCaptureTrack).length}`);
  $('drift-head').textContent = `First → last ${fmt(d.windowSec, 0, ' s')}`;
}

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

async function start() {
  $('start').disabled = true;
  try {
    const capture = await startMic(renderLive);
    session = {
      capture,
      startedAt: new Date().toISOString(),
      timer: setInterval(() => renderMetrics(summarize(capture.track, { targetBand: targetBand() })), 1000),
    };
    $('stop').disabled = false;
    $('export').disabled = true;
    $('export-track').disabled = true;
    setStatus(['Recording. Audio is analysed live and not stored.', ...capture.warnings].join(' '), capture.warnings.length > 0);
  } catch (err) {
    $('start').disabled = false;
    setStatus(`Could not start the microphone: ${err.message}`, true);
  }
}

async function stop() {
  const { capture, startedAt, timer } = session;
  session = null;
  clearInterval(timer);
  await capture.stop();
  lastCaptureTrack = capture.track;
  const metrics = summarize(capture.track, { targetBand: targetBand() });
  renderMetrics(metrics);
  lastExport = {
    schema: 1,
    startedAt,
    sampleRate: capture.sampleRate,
    inputSettings: {
      echoCancellation: capture.applied.echoCancellation ?? null,
      noiseSuppression: capture.applied.noiseSuppression ?? null,
      autoGainControl: capture.applied.autoGainControl ?? null,
    },
    targetBand: targetBand(),
    metrics,
    repetitionCandidates: findRepetitions(capture.track),
  };
  // Tuning aid: level and pitch per 10 ms frame. Not audio; speech cannot be rebuilt from it.
  lastTrack = {
    schema: 1,
    startedAt,
    frameSec: capture.track.frameSec,
    db: capture.track.db.map((v) => Math.round(v * 10) / 10),
    f0: capture.track.f0.map((v) => Math.round(v)),
    ap: capture.track.ap.map((v) => Math.round(v * 100) / 100),
    specBands: capture.track.specBands,
    spec: capture.track.spec.map((v) => Math.round(v)),
  };
  $('export-track').disabled = false;
  $('stop').disabled = true;
  $('start').disabled = false;
  $('export').disabled = false;
  setStatus('Session finished. Metrics only; no audio was kept.');
}

function download(prefix, data, indent) {
  const blob = new Blob([JSON.stringify(data, null, indent)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${prefix}-${data.startedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const exportJson = () => download('voice-metrics', lastExport, 2);
const exportTrack = () => download('voice-track', lastTrack);

// ---- Acceptance self-test (DESIGN.md section 13, phase 1), no microphone needed ----

function tone(freq) {
  return (ctx) => {
    const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: freq });
    const gain = new GainNode(ctx, { gain: 0.3 });
    osc.connect(gain);
    osc.start();
    return gain;
  };
}

function pacedTone(freq, syllablesPerMin) {
  return (ctx) => {
    const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: freq });
    const gain = new GainNode(ctx, { gain: 0.165 });
    const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: syllablesPerMin / 60 });
    const depth = new GainNode(ctx, { gain: 0.135 }); // level swings 0.03..0.3, a 20 dB dip
    lfo.connect(depth).connect(gain.gain);
    osc.connect(gain);
    osc.start();
    lfo.start();
    return gain;
  };
}

async function selfTest() {
  $('selftest').disabled = true;
  const out = $('selftest-results');
  out.innerHTML = '';
  const report = (name, measured, expected, tol, unit) => {
    const ok = measured !== null && Math.abs(measured - expected) <= tol;
    const li = document.createElement('li');
    li.className = ok ? 'pass' : 'fail';
    li.textContent = `${ok ? 'PASS' : 'FAIL'} · ${name}: measured ${fmt(measured, 1)} ${unit}, expected ${expected} ± ${tol} ${unit}`;
    out.append(li);
  };
  try {
    for (const freq of [110, 220]) {
      const m = summarize(await runSynthetic(tone(freq), 2));
      report(`${freq} Hz reference tone`, m.pitch.medianHz, freq, 5, 'Hz');
    }
    for (const spm of [150, 240]) {
      const m = summarize(await runSynthetic(pacedTone(120, spm), 8));
      report(`${spm} syll/min metronome`, m.rate.articulationSpm, spm, 10, 'syll/min');
    }
  } catch (err) {
    const li = document.createElement('li');
    li.className = 'fail';
    li.textContent = `Self-test could not run: ${err.message}`;
    out.append(li);
  }
  $('selftest').disabled = false;
}

// ---- Visual pacer for the metronome-paced reading (silent, so it cannot leak into the mic) ----

function setPacer(on) {
  const spm = Math.min(360, Math.max(60, parseFloat($('pacer-spm').value) || 150));
  const dot = $('pacer-dot');
  dot.style.animationDuration = `${60 / spm}s`;
  dot.classList.toggle('on', on);
  $('pacer-toggle').setAttribute('aria-pressed', String(on));
  $('pacer-toggle').textContent = on ? 'Stop pacer' : 'Start pacer';
}

$('pacer-toggle').addEventListener('click', () => setPacer(!$('pacer-dot').classList.contains('on')));
$('pacer-spm').addEventListener('change', () => setPacer($('pacer-dot').classList.contains('on')));

$('start').addEventListener('click', start);
$('stop').addEventListener('click', stop);
$('export').addEventListener('click', exportJson);
$('export-track').addEventListener('click', exportTrack);
$('selftest').addEventListener('click', selfTest);
