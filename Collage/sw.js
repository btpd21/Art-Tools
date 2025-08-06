// Minimal offline cache for app shell

const CACHE = 'collage-gen-v3';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './collage.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((res) => res || fetch(req).then((net) => {
      // Cache-bust only same-origin GETs
      if (new URL(req.url).origin === location.origin) {
        const copy = net.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return net;
    }).catch(() => caches.match('./index.html')))
  );
});
