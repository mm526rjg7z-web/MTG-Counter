import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildServiceWorker, collectAssets } from '../scripts/update-cache-version.mjs';
import { APP_VERSION } from '../js/version.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(join(root, file), 'utf8');

// ---- generated block in sw.js ---------------------------------------------------------------

test('sw.js is in sync with the app files (run: node scripts/update-cache-version.mjs)', async () => {
  const { current, next } = await buildServiceWorker(root);
  assert.equal(current, next, 'sw.js is out of date: run "node scripts/update-cache-version.mjs"');
});

test('every file that the page, the scripts or the manifest reference is precached', async () => {
  const cached = new Set((await collectAssets(root)).map((f) => f));
  const html = await read('index.html');
  const wanted = new Set();

  for (const [, url] of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    if (!/^(https?:|data:|mailto:)/.test(url)) wanted.add(url);
  }
  // ES module imports: resolve every `from './x.js'` relative to the importing file
  for (const file of [...cached].filter((f) => f.endsWith('.js'))) {
    for (const [, spec] of (await read(file)).matchAll(/from\s+'(\.[^']+)'/g)) {
      wanted.add(posix.normalize(posix.join(posix.dirname(file), spec)));
    }
  }
  for (const icon of JSON.parse(await read('manifest.webmanifest')).icons) wanted.add(icon.src);

  const missing = [...wanted].filter((f) => !cached.has(f));
  assert.deepEqual(missing, [], `not precached: ${missing.join(', ')}`);
  assert.ok(cached.has('index.html') && cached.has('manifest.webmanifest'));
});

test('tests, scripts and docs are not part of the offline cache', async () => {
  const files = await collectAssets(root);
  assert.ok(!files.some((f) => /^(tests|scripts)\//.test(f) || f === 'README.md' || f === 'sw.js'));
});

// ---- service worker behaviour (executed in a sandbox with fake caches) ----------------------------

const ORIGIN = 'https://example.test';
const BASE = `${ORIGIN}/app/`;

function fakeEnvironment({ network = async () => ({ ok: true, from: 'network' }) } = {}) {
  const stores = new Map(); // cache name -> Map(url -> response)
  const fetched = [];
  const abs = (input) => new URL(typeof input === 'string' ? input : input.url, BASE);

  const makeCache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      store,
      async addAll(requests) {
        for (const request of requests) {
          fetched.push(request);
          store.set(abs(request).href, { from: 'precache', url: abs(request).href });
        }
      },
      async match(input, options = {}) {
        const url = abs(input);
        if (options.ignoreSearch) url.search = '';
        return store.get(url.href);
      },
    };
  };
  const caches = {
    open: async (name) => makeCache(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };

  class Request {
    constructor(url, init = {}) {
      this.url = new URL(url, BASE).href;
      this.method = init.method ?? 'GET';
      this.mode = init.mode ?? 'cors';
      this.cache = init.cache;
    }
  }

  const listeners = {};
  const state = { skipped: false, claimed: false, networkCalls: [] };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => { state.skipped = true; },
    clients: { claim: async () => { state.claimed = true; } },
  };
  const context = vm.createContext({
    self,
    caches,
    Request,
    URL,
    Promise,
    fetch: async (request) => {
      state.networkCalls.push(request.url);
      return network(request);
    },
  });
  return { context, listeners, stores, caches, fetched, state, Request };
}

async function loadServiceWorker(options) {
  const env = fakeEnvironment(options);
  new vm.Script(await read('sw.js'), { filename: 'sw.js' }).runInContext(env.context);
  env.assets = vm.runInContext('ASSETS', env.context);
  env.cacheName = vm.runInContext('CACHE_NAME', env.context);
  env.event = async (type, payload = {}) => {
    let waiting;
    const event = { ...payload, waitUntil: (p) => { waiting = p; } };
    env.listeners[type](event);
    await waiting;
  };
  env.fetchEvent = (request) => {
    let response;
    let responded = false;
    env.listeners.fetch({ request, respondWith: (p) => { responded = true; response = p; } });
    return { responded, response };
  };
  return env;
}

test('install precaches every asset, bypassing the HTTP cache, and activates immediately', async () => {
  const env = await loadServiceWorker();
  await env.event('install');
  const cache = env.stores.get(env.cacheName);
  assert.ok(cache, 'cache was created');
  const expected = (await collectAssets(root)).length + 1; // + './'
  assert.equal(env.assets.length, expected);
  assert.equal(cache.size, expected);
  assert.ok(env.fetched.every((r) => r.cache === 'reload'), 'precache requests use cache: "reload"');
  assert.equal(env.state.skipped, true);
});

test('the cache name carries the version and starts with the shared prefix', async () => {
  const env = await loadServiceWorker();
  assert.match(env.cacheName, /^mtg-counter-[0-9a-f]{10}$/);
});

test('activate deletes old app caches but leaves foreign caches alone', async () => {
  const env = await loadServiceWorker();
  await env.caches.open('mtg-counter-oldversion');
  await env.caches.open('mtg-counter-older');
  await env.caches.open('some-other-app');
  await env.event('install');
  await env.event('activate');
  assert.deepEqual([...env.stores.keys()].sort(), [env.cacheName, 'some-other-app'].sort());
  assert.equal(env.state.claimed, true);
});

test('fetch is cache-first: cached files never touch the network', async () => {
  const env = await loadServiceWorker();
  await env.event('install');
  const { responded, response } = env.fetchEvent(new env.Request('./app.js'));
  assert.equal(responded, true);
  assert.equal((await response).from, 'precache');
  assert.deepEqual(env.state.networkCalls, []);
});

test('the query string does not defeat the cache (index.html?source=pwa)', async () => {
  const env = await loadServiceWorker();
  await env.event('install');
  const { response } = env.fetchEvent(new env.Request('./index.html?source=pwa', { mode: 'navigate' }));
  assert.equal((await response).from, 'precache');
  assert.deepEqual(env.state.networkCalls, []);
});

test('uncached files go to the network', async () => {
  const env = await loadServiceWorker();
  await env.event('install');
  const { response } = env.fetchEvent(new env.Request('./not-cached.txt'));
  assert.equal((await response).from, 'network');
  assert.equal(env.state.networkCalls.length, 1);
});

test('offline: navigations fall back to the cached app shell, other requests fail', async () => {
  const env = await loadServiceWorker({ network: async () => { throw new TypeError('offline'); } });
  await env.event('install');
  const nav = env.fetchEvent(new env.Request('./some/deep/link', { mode: 'navigate' }));
  const shell = await nav.response;
  assert.equal(shell.url, `${BASE}index.html`);
  const asset = env.fetchEvent(new env.Request('./unknown.js'));
  await assert.rejects(asset.response, TypeError);
});

test('non-GET and cross-origin requests are not intercepted', async () => {
  const env = await loadServiceWorker();
  await env.event('install');
  assert.equal(env.fetchEvent(new env.Request('./app.js', { method: 'POST' })).responded, false);
  assert.equal(env.fetchEvent(new env.Request('https://other.example/app.js')).responded, false);
});

// ---- manifest and icons ---------------------------------------------------------------------

function pngInfo(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', 'not a PNG file');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
}

test('manifest has everything an installable standalone portrait app needs', async () => {
  const m = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.orientation, 'portrait');
  assert.equal(m.lang, 'de');
  assert.ok(m.name.length > 0 && m.short_name.length > 0 && m.short_name.length <= 12);
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
});

test('manifest icons exist with the declared size; 192 and 512 come as "any" and "maskable"', async () => {
  const m = JSON.parse(await read('manifest.webmanifest'));
  for (const purpose of ['any', 'maskable']) {
    for (const size of [192, 512]) {
      const icon = m.icons.find((i) => i.sizes === `${size}x${size}` && i.purpose === purpose);
      assert.ok(icon, `missing ${purpose} icon ${size}x${size}`);
      assert.equal(icon.type, 'image/png');
      const info = pngInfo(await readFile(join(root, icon.src)));
      assert.deepEqual([info.width, info.height], [size, size], icon.src);
      if (purpose === 'maskable') assert.equal(info.colorType, 2, `${icon.src} must be opaque (RGB)`);
    }
  }
  for (const icon of m.icons) await readFile(join(root, icon.src)); // every declared file exists
});

test('index.html wires up manifest, icons, theme colour and the iOS home screen metadata', async () => {
  const html = await read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}">/i);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  const apple = pngInfo(await readFile(join(root, 'icons/apple-touch-icon.png')));
  assert.deepEqual([apple.width, apple.height, apple.colorType], [180, 180, 2]);
  assert.match(html, /lang="de"/);
});

test('the version shown in the help matches the format x.y.z', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});
