// PNPtv! Service Worker — Push Notifications + Offline App Shell Cache

const CACHE_NAME = 'pnptv-v21';
const APP_SHELL = [
  '/Logo2-50.png',
  '/logo-login.png',
  '/logo-header.png',
  '/logo-nav.png',
  '/app-icon-192.png',
  '/app-icon-512.png',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Listen for skip-waiting message from the app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API/navigation, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls: network only
  if (url.pathname.startsWith('/api/')) return;

  // Hashed assets (JS/CSS in /assets/): network-first, cache fallback
  // These filenames contain content hashes so stale cache = broken app after deploy
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request).then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return resp;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Other static assets (images, fonts): cache-first
  if (url.pathname.match(/\.(png|jpg|jpeg|svg|webp|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return resp;
      }))
    );
    return;
  }

  // Navigation (HTML): always network, no cache (ensures fresh chunk references)
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request));
    return;
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'PNPtv!', body: event.data.text() || '' };
    }
  }
  const title = data.title || 'PNPtv!';
  const options = {
    body: data.body || '',
    icon: data.icon || '/Logo2-50.png',
    badge: '/Logo2-50.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  const isUpdate = url.includes('update=1');

  event.waitUntil(
    (isUpdate
      ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      : Promise.resolve()
    ).then(() =>
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
    )
  );
});
