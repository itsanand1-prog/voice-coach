// Helpers for frame tracks ({frameSec, db[], f0[], and optionally spec[] with specBands per frame}).

const JOIN_GAP_SEC = 0.5;
const SILENT_DB = -120;

export function sliceTrack(track, from, to) {
  const out = { frameSec: track.frameSec, db: track.db.slice(from, to), f0: track.f0.slice(from, to) };
  if (track.spec) {
    out.specBands = track.specBands;
    out.spec = track.spec.slice(from * track.specBands, to * track.specBands);
  }
  return out;
}

/** Join tracks end to end with a short silence between, so speech in one never merges into the next. */
export function concatTracks(tracks) {
  const frameSec = tracks.length ? tracks[0].frameSec : 0.01;
  const gap = Math.round(JOIN_GAP_SEC / frameSec);
  const withSpec = tracks.length > 0 && tracks.every((t) => t.spec);
  const bands = withSpec ? tracks[0].specBands : 0;
  const db = [];
  const f0 = [];
  const spec = [];
  tracks.forEach((t, i) => {
    if (i > 0) {
      for (let k = 0; k < gap; k++) {
        db.push(SILENT_DB);
        f0.push(0);
        for (let b = 0; b < bands; b++) spec.push(SILENT_DB);
      }
    }
    for (let k = 0; k < t.db.length; k++) {
      db.push(t.db[k]);
      f0.push(t.f0[k]);
    }
    if (withSpec) for (let k = 0; k < t.spec.length; k++) spec.push(t.spec[k]);
  });
  return withSpec ? { frameSec, db, f0, spec, specBands: bands } : { frameSec, db, f0 };
}
