// PNPtv! Service Worker — Push Notifications + Offline App Shell Cache

// CACHE_NAME is auto-bumped on every build by scripts/build-web.sh — never
// edit by hand. Contains a git short SHA so each deploy invalidates every
// previously-cached asset (image, font, app shell).
const CACHE_NAME = 'pnptv-__BUILD_ID__';
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

  // Hashed assets (JS/CSS in /assets/): network-first, cache fallback.
  // These filenames contain content hashes so stale cache = broken app after deploy.
  // Only cache 2xx responses — a 404 during a rebuild race must NEVER be cached
  // (it would persist as a phantom-missing chunk even after the file returns).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request).then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        } else if (resp && resp.status === 404) {
          caches.open(CACHE_NAME).then((cache) => cache.delete(request));
        }
        return resp;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Other static assets (images, fonts): stale-while-revalidate. Return the
  // cached copy immediately for speed, then fetch in the background to
  // refresh the cache for the next request. A logo/theme PNG that changes
  // server-side reaches the user on the next page load — never pinned forever.
  if (url.pathname.match(/\.(png|jpg|jpeg|svg|webp|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request).then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return resp;
        }).catch(() => cached);
        return cached || networkFetch;
      })
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
  const rawUrl = event.notification.data?.url || '/';

  // If the notification URL had ?update=1, the SW handles cache clearing here
  // and strips the param before navigating — avoids a blank-page flash in WebViews
  // where window.location.replace() after body-clear can fail silently.
  let isUpdate = false;
  let navUrl = rawUrl;
  let isExternal = false;
  try {
    const u = new URL(rawUrl, self.location.origin);
    isExternal = u.origin !== self.location.origin;
    isUpdate = u.searchParams.get('update') === '1' || u.searchParams.get('reset') === '1';
    if (isUpdate) {
      u.searchParams.delete('update');
      u.searchParams.delete('reset');
      navUrl = u.toString();
    }
  } catch {
    navUrl = '/';
  }

  // External URL (third-party checkout, etc.): always openWindow — client.navigate
  // is same-origin only and would no-op, leaving the user staring at PNPtv.
  if (isExternal) {
    event.waitUntil(clients.openWindow(navUrl));
    return;
  }

  event.waitUntil(
    (isUpdate
      ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      : Promise.resolve()
    ).then(() =>
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(navUrl);
            return client.focus();
          }
        }
        return clients.openWindow(navUrl);
      })
    )
  );
});
