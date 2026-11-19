/* NFT FaceCam service worker: lets the installed app open fast and keeps the
 * face-tracking engine cached after the first download. Camera video is never
 * touched here — it only caches the app's own files and public libraries. */
const VERSION = 'facecam-v5';
const APP = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/config.js', 'js/util.js', 'js/storage.js', 'js/demoAvatars.js', 'js/imageProcess.js', 'js/tracker.js', 'js/pose.js',
  'js/avatar2d.js', 'js/avatar3d.js', 'js/background.js', 'js/output.js', 'js/wallet.js', 'js/faceEditor.js', 'js/recorder.js', 'js/app.js'];
const CDN = /^(https:\/\/(cdn\.jsdelivr\.net|storage\.googleapis\.com|fonts\.googleapis\.com|fonts\.gstatic\.com))\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'facecam-cdn').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (CDN.test(url)) {
    // libraries & models: cache-first (they are versioned)
    e.respondWith(caches.open('facecam-cdn').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  } else if (url.startsWith(self.location.origin)) {
    // app files: network-first so updates show up, cache when offline
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
  }
});
