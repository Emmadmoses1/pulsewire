// WAVZO service worker: lets the site install as an app and shows a friendly page when offline
const V = 'wz-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(['/offline.html', '/images/wavzo-icon-192.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin || /^\/(admin|api|data|track|subscribe)/.test(u.pathname)) return;
  const save = (res) => { if (res && res.ok) { const c = res.clone(); caches.open(V).then((ch) => ch.put(r, c)); } return res; };
  if (/\.(png|jpe?g|webp|svg|ico|woff2?)$/i.test(u.pathname)) { e.respondWith(caches.match(r).then((m) => m || fetch(r).then(save))); return; }
  e.respondWith(fetch(r).then(save).catch(() => caches.match(r).then((m) => m || (r.mode === 'navigate' ? caches.match('/offline.html') : Response.error()))));
});
