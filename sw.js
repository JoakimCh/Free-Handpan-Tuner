const PREFIX = `free-handpan-${new URL(self.registration.scope).pathname}-`;
const CACHE = `${PREFIX}v3`;
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './icons/handpan.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './src/app.mjs', './src/views.mjs', './src/editor.mjs', './src/model.mjs', './src/storage.mjs',
  './src/audio.mjs', './src/capture-worklet.mjs', './src/analysis-worker.mjs', './src/strike-collector.mjs',
  './src/analyze-strike.mjs', './src/spectrum.mjs',
].map(path => new URL(path, self.registration.scope).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(new URL('./index.html', self.registration.scope).href)
        ?? Response.error();
    }));
    return;
  }
  if (ASSETS.includes(url.href)) {
    event.respondWith(caches.open(CACHE).then(async cache => await cache.match(event.request) ?? fetch(event.request)));
  }
});
