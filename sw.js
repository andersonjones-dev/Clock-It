/*
 * CLOCKIT — service worker (offline support)
 * ---------------------------------------------------------------
 * IMPORTANT: every time you change any app file and publish it,
 * raise VERSION below (e.g. 1.0.0 -> 1.0.1). That tells phones a
 * new version exists; the app then offers an "Update" button.
 */
var VERSION = '2.2.1';
var CACHE = 'clockit-' + VERSION;

// Everything the app needs to run with no internet connection.
var APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './js/engine.js',
  './js/timers.js',
  './js/sound.js',
  './js/chaos.js',
  './js/shell.js',
  './js/app.js',
  './js/group.js',
  './js/showtime.js',
  './js/stopwatch.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // cache: 'reload' skips the browser's HTTP cache so we store fresh copies
      return cache.addAll(APP_FILES.map(function (url) { return new Request(url, { cache: 'reload' }); }));
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if ((key.indexOf('clockit-') === 0 || key.indexOf('duel-clock-') === 0) && key !== CACHE) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// The page asks the waiting worker to take over when the user taps "Update".
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page loads: serve the cached app shell so it opens instantly and offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(function (cached) {
        if (cached) return cached;
        // Not saved yet (or removed): fetch it and save it for next time.
        return fetch(req).then(function (res) {
          if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put('./index.html', copy); }); }
          return res;
        });
      }).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  // Files: cache first, then network (and remember anything new).
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
    })
  );
});
