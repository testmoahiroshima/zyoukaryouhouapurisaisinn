// 一度開けば電波が無くても使えるように、アプリの部品を端末に保存する（外へは何も送らない）。
// アプリの部品を変えた時は VERSION を上げる。
const VERSION = 'joka-v6';
const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'app/style.css', 'app/app.js', 'app/engine.js', 'app/paint.js', 'app/body3d.js', 'app/zones.js', 'app/audio.js', 'app/records.js',
  'app/vendor/three.module.min.js', 'data/body3d.bin',
  'data/body_points.json', 'data/flows.json', 'data/routes.json', 'data/symptoms.json', 'data/safety.json', 'data/concepts.json',
  'data/changes.json', 'data/places.json', 'data/knowledge.json', 'data/kenkai.json', 'data/zenshu_terms.json',
  'icons/icon-192.png', 'icons/icon-512.png', '施術記録人体図.jpg',
];
// 大きくて変わりにくいものは、保存してあるものを先に使う
const CACHE_FIRST = [/\/app\/vendor\//, /\/data\/body3d\.bin$/, /^https:\/\/fonts\.(googleapis|gstatic)\.com\//];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && !CACHE_FIRST.some((r) => r.test(req.url))) return;
  if (CACHE_FIRST.some((r) => r.test(req.url))) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // それ以外：まず新しいものを取りに行き、電波が無ければ保存してあるものを使う
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
