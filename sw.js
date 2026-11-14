// Cache-first service worker for the app shell.
// The cache name comes from js/version.js, so bumping the version (scripts/bump-version.sh)
// both changes this worker (the browser re-checks imported scripts) and refreshes the cache.
importScripts('js/version.js');

const CACHE = `starter-tracker-${self.APP_VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'vendor/bootstrap.min.css',
  'js/version.js',
  'js/app.js',
  'js/logic.js',
  'js/store.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache:'reload' skips the HTTP cache so a new version never precaches stale files
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.searchParams.has('check')) return; // update check: always go to the network
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request).catch(() =>
          e.request.mode === 'navigate' ? caches.match('index.html') : Response.error(),
        ),
    ),
  );
});
