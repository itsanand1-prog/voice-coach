import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p));

function pngSize(path) {
  const b = read(path);
  assert.equal(b.toString('ascii', 1, 4), 'PNG', `${path} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function filesUnder(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const p = join(dir, name);
    return statSync(join(root, p)).isDirectory() ? filesUnder(p) : [p.split(sep).join('/')];
  });
}

// ---- install ----

test('manifest: installable as a standalone app from the folder it is served in', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Voice Coach');
  assert.ok(m.short_name && m.short_name.length <= 12);
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
});

test('manifest: 192 and 512 px icons, plus a maskable one, all real PNGs of the stated size', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  for (const size of [192, 512]) assert.ok(m.icons.some((i) => i.sizes === `${size}x${size}` && i.type === 'image/png'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of m.icons) {
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(icon.src), { width: w, height: h });
  }
});

test('pages link the manifest and set the theme colour', () => {
  for (const page of ['index.html', 'bench.html']) {
    const html = read(page).toString();
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/, page);
    assert.match(html, /<meta name="theme-color"/, page);
  }
});

// ---- offline ----

const sw = read('sw.js').toString();
const listStart = sw.indexOf('const PRECACHE = [');
const precache = [...sw.slice(listStart, sw.indexOf('];', listStart)).matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('offline: the service worker stores every file the app needs', () => {
  const needed = ['./', 'index.html', 'bench.html', 'manifest.webmanifest', ...filesUnder('icons'), ...filesUnder('src')];
  for (const f of needed) assert.ok(precache.includes(f), `missing from PRECACHE in sw.js: ${f}`);
});

test('offline: every stored file exists, and nothing private is stored', () => {
  for (const f of precache.filter((x) => x !== './')) assert.ok(existsSync(join(root, f)), `listed but missing: ${f}`);
  for (const f of precache) assert.ok(!/voice-|\.pdf$|DESIGN|README/i.test(f), `private or unneeded file listed: ${f}`);
});

test('offline: the service worker is registered by both pages', () => {
  assert.match(read('src/ui/app.js').toString(), /registerServiceWorker\(/);
  assert.match(read('src/bench.js').toString(), /registerServiceWorker\(/);
});

test('the test runner itself is not cached', () => {
  assert.ok(!precache.some((f) => f.startsWith('test/') || f.startsWith('tools/')));
  assert.equal(relative(root, root), '');
});
