const CACHE_NAME = 'emonitor-cache-v6';

const urlsToCache = [
  '/static/manifest.json',
  '/static/icons/icon-192x192.png',
  '/static/icons/icon-512x512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  // Fuerza a que este Service Worker sea el activo inmediatamente
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Borrar CUALQUIER caché que no sea la actual
          if (cacheName !== CACHE_NAME) {
            console.log('Borrando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Toma el control de los clientes abiertos sin necesidad de recargar la página
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  const url = new URL(event.request.url);

  // NEVER cache: API calls, the main HTML page, or files with cache-buster query params
  const isAPI = url.pathname.startsWith('/api/');
  const isMainPage = url.pathname === '/';
  const hasCacheBuster = url.search.includes('v=');

  if (isAPI || isMainPage || hasCacheBuster) {
    // Network only - always fetch fresh
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // For static external resources (leaflet, fonts, fontawesome): Network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// --- PUSH NOTIFICATIONS ---

self.addEventListener('push', event => {
  let data = { title: 'E-Monitor Live', body: 'Nueva avería detectada' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/static/icons/icon-192x192.png',
    badge: '/static/icons/icon-96x96.png',
    vibrate: [200, 100, 200],
    tag: data.data?.municipio ? `averia-${data.data.municipio}` : 'averia-general',
    renotify: true,
    data: data.data || {},
    actions: [
      { action: 'open', title: 'Ver en mapa' },
      { action: 'close', title: 'Cerrar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'close') return;

  const notifData = event.notification.data;
  let url = '/';
  if (notifData.municipio) {
    url = `/?search=${encodeURIComponent(notifData.municipio)}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Intentar enfocar una ventana existente
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            municipio: notifData.municipio,
            objectid: notifData.objectid
          });
          return;
        }
      }
      // No hay ventana abierta, abrir una nueva
      return clients.openWindow(url);
    })
  );
});
