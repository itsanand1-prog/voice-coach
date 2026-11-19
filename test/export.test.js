import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, exportFileName, parseExport, mergeSessions, EXPORT_SCHEMA } from '../src/export.js';
import { initialState, rebuildState } from '../src/game/progress.js';

const rec = (startedAt, extra = {}) => ({ startedAt, day: startedAt.slice(0, 10), durationSec: 1000, segments: [], metrics: {}, ...extra });
const state = { ...initialState(), xp: 230, sessions: 3, ladder: { step: 1, passes: 2 }, pitchStepsDown: 1, baselineHz: [150, 152] };

test('export: holds the session records and a progress summary, newest last', () => {
  const sessions = [rec('2026-11-19T02:38:01.000Z'), rec('2026-11-17T16:08:17.000Z')];
  const e = buildExport(sessions, state, { now: new Date('2026-11-19T10:00:00Z') });
  assert.equal(e.schema, EXPORT_SCHEMA);
  assert.equal(e.exportedAt, '2026-11-19T10:00:00.000Z');
  assert.deepEqual(e.sessions.map((s) => s.startedAt), ['2026-11-17T16:08:17.000Z', '2026-11-19T02:38:01.000Z']);
  assert.deepEqual(e.progress, { xp: 230, sessions: 3, streak: state.streak, ladder: { step: 1, passes: 2 }, baselineHz: [150, 152], pitchStepsDown: 1, badges: {} });
});

test('export: "new sessions" means those started after the last export', () => {
  const sessions = [rec('2026-11-17T16:08:17.000Z'), rec('2026-11-19T02:38:01.000Z')];
  const e = buildExport(sessions, state, { since: '2026-11-18T00:00:00.000Z', now: new Date('2026-11-19T10:00:00Z') });
  assert.deepEqual(e.sessions.map((s) => s.startedAt), ['2026-11-19T02:38:01.000Z']);
});

test('export: never contains audio-derived frame data', () => {
  const sneaky = rec('2026-11-19T02:38:01.000Z', { track: { db: [1, 2], spec: [3] } });
  const json = JSON.stringify(buildExport([sneaky], state, { now: new Date() }));
  assert.ok(!/"(db|f0|spec|track)":/.test(json));
});

test('export: file is named by date', () => {
  assert.equal(exportFileName(new Date('2026-11-19T10:00:00Z')), 'voice-coach-export-2026-11-19.json');
});

// ---- import ----

test('import: reads an export file back', () => {
  const e = buildExport([rec('2026-11-19T02:38:01.000Z')], state, { now: new Date('2026-11-19T10:00:00Z') });
  assert.equal(parseExport(JSON.stringify(e)).sessions.length, 1);
});

test('import: a single session file downloaded from the results screen is accepted too', () => {
  const one = rec('2026-11-19T02:38:01.000Z', { schema: 2 });
  assert.deepEqual(parseExport(JSON.stringify(one)).sessions.map((s) => s.startedAt), ['2026-11-19T02:38:01.000Z']);
});

test('import: other files are refused with a plain explanation', () => {
  assert.throws(() => parseExport('not json'), /not a Voice Coach file/);
  assert.throws(() => parseExport(JSON.stringify({ schema: 1, frameSec: 0.01, db: [] })), /tuning track/);
  assert.throws(() => parseExport(JSON.stringify({ hello: 1 })), /not a Voice Coach file/);
});

test('import: merging skips sessions already on this device', () => {
  const existing = [rec('2026-11-17T16:08:17.000Z', { mine: true })];
  const incoming = [rec('2026-11-17T16:08:17.000Z', { mine: false }), rec('2026-11-19T02:38:01.000Z')];
  const { merged, added } = mergeSessions(existing, incoming);
  assert.equal(added.length, 1);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((s) => s.startedAt.startsWith('2026-11-17')).mine, true);
});

test('rebuild keeps the date of the last export', () => {
  const s = rebuildState({ ...initialState(), lastExportAt: '2026-11-18T09:00:00.000Z' }, []);
  assert.equal(s.lastExportAt, '2026-11-18T09:00:00.000Z');
});
