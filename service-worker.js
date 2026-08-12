const CACHE_NAME = 'sentinelle-pro-v5-11-6-test-safe-fast-mci';
const CDN_CACHE_NAME = 'sentinelle-cdn-v5-11-6-safe-fast-mci';
const APP_SHELL = [
  './',
  './index.html',
  './style.css?v=5116f',
  './app.js?v=5116f',
  './sentinelle-config.js?v=5116f',
  './supabase-compat.js?v=5116f',
  './supabase-config.js?v=5116f',
  './supabase-bridge.js?v=5116f',
  './manifest.json',
  './manifest-client.json',
  './offline.html',
  './client.html',
  './client-style.css?v=597',
  './client-app.js?v=597',
  './reset-password.html',
  './reset-password.js?v=593',
  './assets/logo.png',
  './assets/client-logo.png',
  './assets/favicon.png',
  './assets/icons/icon-192.png',
  './assets/icons/client-180.png',
  './assets/icons/client-192.png',
  './assets/icons/client-512.png'
];

const TRUSTED_OFFLINE_CDN = new Set([
  'www.gstatic.com',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', event => {
  // V5.8.8.6 : un asset secondaire manquant ne doit plus faire échouer
  // l'installation complète du Service Worker sur iOS/GitHub Pages.
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE_NAME);
    for (const asset of APP_SHELL) {
      try { await cache.add(asset); }
      catch (error) { console.warn('[Sentinelle SW] cache ignoré', asset, error); }
    }
  })());
  // Pas de skipWaiting forcé : on évite de couper une mission déjà ouverte.
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => {
      const isSentinelleCache = key.startsWith('sentinelle-pro-') || key.startsWith('sentinelle-cdn-');
      return isSentinelleCache && ![CACHE_NAME, CDN_CACHE_NAME].includes(key) ? caches.delete(key) : Promise.resolve(false);
    })))
  );
  self.clients.claim();
});

async function networkFirst(request, cacheName=CACHE_NAME, fallback=null){
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    return (await caches.match(request)) || (fallback ? await caches.match(fallback) : null) || Response.error();
  }
}

async function staleWhileRevalidate(request){
  const cache = await caches.open(CDN_CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => null);
  return cached || await network || Response.error();
}

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body:event.data?.text?.() || 'Nouvelle information Sentinelle Pro' }; }
  const title = String(payload.title || 'Sentinelle Pro');
  const options = {
    body:String(payload.body || payload.message || 'Nouvelle information opérationnelle'),
    icon:payload.icon || './assets/icons/icon-192.png',
    badge:payload.badge || './assets/icons/icon-192.png',
    tag:String(payload.tag || payload.notificationId || `sentinelle-${Date.now()}`),
    renotify:Boolean(payload.renotify),
    requireInteraction:Boolean(payload.requireInteraction),
    data:{ url:payload.url || './index.html', route:payload.route || 'home', ...(payload.data || {}) }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const notificationData = event.notification?.data || {};
  const fallback = `./index.html?route=${encodeURIComponent(notificationData.route || 'home')}`;
  const targetUrl = new URL(notificationData.url || fallback, self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const client of clientsList) {
      try {
        const current = new URL(client.url);
        const target = new URL(targetUrl);
        if (current.origin === target.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(targetUrl).catch(()=>{});
          return;
        }
      } catch (_) {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (TRUSTED_OFFLINE_CDN.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    const clientPortal = /\/client\.html$/i.test(url.pathname);
    const resetPortal = /\/reset-password\.html$/i.test(url.pathname);
    const fallbackPage = resetPortal ? './reset-password.html' : (clientPortal ? './client.html' : './index.html');
    event.respondWith(networkFirst(request, CACHE_NAME, fallbackPage).then(async response => {
      if (response && response.type !== 'error') return response;
      return (await caches.match(fallbackPage)) || (await caches.match('./offline.html'));
    }));
    return;
  }
  event.respondWith(networkFirst(request, CACHE_NAME));
});
