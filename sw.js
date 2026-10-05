// Sync Up service worker: keeps a copy of the app itself (page, code library,
// fonts, icons) so it can still open with no internet. The tasks shown offline
// come from the app's own saved copy (see "Offline view" in index.html); live
// data from Supabase and the Claude connector (/api) is never cached here.
const CACHE = 'syncup-v1';
const SHELL = ['/', '/logo-mark.png', '/icon-192.png', '/favicon-32.png', '/apple-touch-icon.png', '/favicon.ico'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return; // live data: always straight from the server
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // The page itself: newest version when online (so updates show right away),
  // the saved copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)); }
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Code library, fonts, icons: use the saved copy and refresh it in the background.
  const cacheable = url.origin === self.location.origin || url.hostname === 'esm.sh'
    || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;
  e.respondWith(
    caches.match(req).then(hit => {
      const fresh = fetch(req)
        .then(res => {
          if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => hit);
      return hit || fresh;
    }),
  );
});
