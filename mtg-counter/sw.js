// Service worker: cache-first for all app files, so the app starts and runs fully offline after
// the first visit.
//
// CACHE_VERSION and ASSETS are generated from the real files by scripts/update-cache-version.mjs.
// Run `node scripts/update-cache-version.mjs` after changing any app file: a new version creates a
// new cache, and the activate step below deletes the old ones. (tests/pwa.test.mjs fails when the
// generated block is out of date, so a forgotten update cannot reach users unnoticed.)

const CACHE_PREFIX = 'mtg-counter-';
const CACHE_VERSION = 'f71913dccb';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './js/board.js',
  './js/dialogs.js',
  './js/dom.js',
  './js/field.js',
  './js/format.js',
  './js/game.js',
  './js/haptics.js',
  './js/hold.js',
  './js/layout.js',
  './js/palette.js',
  './js/random.js',
  './js/setup.js',
  './js/storage.js',
  './js/tools.js',
  './js/version.js',
  './js/wakelock.js',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/icon-maskable.svg',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // cache: 'reload' bypasses the browser's HTTP cache, so a fresh install never stores stale files
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  // ignoreSearch: "index.html?source=pwa" is still the same app shell
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch (error) {
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw error;
  }
}
