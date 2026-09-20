/* Subtext's service worker — only used when the app is hosted (GitHub Pages).

   Two jobs:

   1. Network first, cache second, so you get the newest version when you have a
      connection and the last one you saw when you do not. Everything the app
      needs is inside index.html, so once that is cached it runs with no signal.

   2. Catching a shared video. Android's share sheet sends the file as a POST,
      which a page cannot read; only a service worker can. So the file is put in
      a cache under a known name and the browser is redirected back to the app,
      which picks it up from there and deletes it.

   Its scope is this folder, so it never touches anything else on the site.    */

const CACHE = 'subtext-v1';
const SHARE = 'subtext-share';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => { }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SHARE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.origin === location.origin && url.searchParams.has('share')) {
    e.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.get('media');
        if (file && file.size) {
          const cache = await caches.open(SHARE);
          await cache.put('shared-media', new Response(file, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              // Header values must be ASCII, and a filename very often is not.
              'X-Name': encodeURIComponent(file.name || 'shared-video')
            }
          }));
        }
      } catch (err) { /* fall through: the app opens empty rather than breaking */ }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
