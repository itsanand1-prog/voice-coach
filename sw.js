// Service worker: lets the app open and run with no connection.
// Strategy: network first (so an online phone always gets the latest version), falling back to
// the stored copy when offline or when the network takes longer than 4 s. Only the app's own
// files are stored; nothing else that passes through is kept.
// Bump CACHE when the PRECACHE list changes, so old copies are cleared.

const CACHE = 'voice-coach-v1';
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  './',
  'index.html',
  'bench.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/analyzer.js',
  'src/audio/capture-worklet.js',
  'src/audio/capture.js',
  'src/bench.js',
  'src/content/prompts.js',
  'src/dsp/pitch.js',
  'src/dsp/spectrum.js',
  'src/dsp/stats.js',
  'src/export.js',
  'src/game/goals.js',
  'src/game/pitchTarget.js',
  'src/game/progress.js',
  'src/game/technique.js',
  'src/live/cues.js',
  'src/live/karaoke.js',
  'src/live/snapshot.js',
  'src/repetition.js',
  'src/session/drift.js',
  'src/session/ladder.js',
  'src/session/quality.js',
  'src/session/record.js',
  'src/session/review.js',
  'src/session/template.js',
  'src/store.js',
  'src/summary.js',
  'src/sw-register.js',
  'src/track.js',
  'src/ui/app.js',
  'src/ui/karaoke-view.js',
];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;
const KNOWN = new Set(PRECACHE.map(scopeUrl));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const url = new URL(req.url);
  url.search = '';
  const key = url.href; // "?demo=1" and the like share the stored page
  try {
    const res = await fetchWithTimeout(req, NETWORK_TIMEOUT_MS);
    if (res.ok && KNOWN.has(key)) cache.put(key, res.clone());
    return res;
  } catch {
    const stored = (await cache.match(key)) ?? (req.mode === 'navigate' ? await cache.match(scopeUrl('index.html')) : undefined);
    return stored ?? Response.error();
  }
}

function fetchWithTimeout(req, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(req, { signal: controller.signal }).finally(() => clearTimeout(timer));
}
