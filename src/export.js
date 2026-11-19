// Export and import of session records (DESIGN.md section 12: metrics JSON exported manually
// to a separate Google Drive). The export holds metrics and answers only, never frame data.
// The coach-review artifact (phase 4) reads this format.

export const EXPORT_SCHEMA = 'voice-coach-export/1';

const FRAME_KEYS = new Set(['track', 'db', 'f0', 'ap', 'spec']);

function withoutFrames(value) {
  return JSON.parse(JSON.stringify(value, (k, v) => (FRAME_KEYS.has(k) ? undefined : v)));
}

/**
 * @param sessions stored session records
 * @param state    progress state
 * @param o.since  ISO time: only sessions started after it ("new since last export")
 * @param o.now    Date of the export
 */
export function buildExport(sessions, state, { since = null, now = new Date() } = {}) {
  const chosen = sessions
    .filter((s) => since === null || s.startedAt > since)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  return {
    schema: EXPORT_SCHEMA,
    exportedAt: now.toISOString(),
    since,
    progress: {
      xp: state.xp,
      sessions: state.sessions,
      streak: state.streak,
      ladder: state.ladder,
      baselineHz: state.baselineHz,
      pitchStepsDown: state.pitchStepsDown,
      badges: state.badges,
    },
    sessions: withoutFrames(chosen),
  };
}

export function exportFileName(now = new Date()) {
  return `voice-coach-export-${now.toISOString().slice(0, 10)}.json`;
}

/** Accepts an export file or a single session file; refuses anything else with a plain reason. */
export function parseExport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a Voice Coach file.');
  }
  if (data && data.schema === EXPORT_SCHEMA && Array.isArray(data.sessions)) return { sessions: data.sessions };
  if (data && typeof data.startedAt === 'string' && Array.isArray(data.segments)) return { sessions: [data] };
  if (data && Array.isArray(data.db) && data.frameSec) {
    throw new Error('This is a tuning track, which is for analysis only. Choose an export file or a session file.');
  }
  throw new Error('This is not a Voice Coach file.');
}

/** Adds sessions not already present (matched by start time); existing records win. */
export function mergeSessions(existing, incoming) {
  const have = new Set(existing.map((s) => s.startedAt));
  const added = [];
  for (const s of incoming) {
    if (have.has(s.startedAt)) continue;
    have.add(s.startedAt);
    added.push(s);
  }
  return { merged: [...existing, ...added], added };
}
