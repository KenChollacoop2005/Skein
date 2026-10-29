const CACHE = 'skein-v2';
const ASSETS = [
  './', 'index.html', 'setup.html', 'editor.html', 'race.html', 'manifest.webmanifest',
  'css/skein.css',
  'fonts/atkinson-400.woff2', 'fonts/atkinson-700.woff2', 'fonts/fraunces-600.woff2',
  'icons/icon.svg', 'icons/favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/storage.js', 'js/store.js', 'js/graph.js', 'js/route.js', 'js/match.js', 'js/plan.js',
  'js/map-svg.js', 'js/ui-list.js', 'js/ui-route.js', 'js/ui-print.js', 'js/editor.js',
  'js/physarum.js', 'js/race.js', 'js/sensors.js', 'js/trace.js', 'js/setup.js',
  'data/store.json', 'data/catalog.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pages network first, other files cache first
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        if (res.ok) caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
