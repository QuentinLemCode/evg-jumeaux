/* eslint-disable */
/**
 * Service worker (spec 0009, rules 12-15).
 *
 * Two jobs, and deliberately no more:
 *
 *   1. receive push messages and show them (spec 0006);
 *   2. serve an offline page when a navigation fails.
 *
 * It does NOT cache data. A stale leaderboard or a stale invitation looks
 * current and is therefore worse than an error — and invitations expire in five
 * minutes, so "slightly old" is the same as "wrong".
 */

const VERSION = 'evg-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const OFFLINE_URL = '/offline';

const SHELL_ASSETS = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      // Claim open tabs immediately so a deployment takes effect on the next
      // navigation instead of the next cold start.
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Navigations: network first, offline page as the fallback. Never a cached
  // page — see the note at the top of this file.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        const offline = await cache.match(OFFLINE_URL);
        return offline ?? new Response('Hors ligne', { status: 503 });
      }),
    );
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Static build output and icons only: immutable by URL, safe to cache.
  const cacheable = url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icons/');
  if (!cacheable) return;

  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'EVG des Jumeaux';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'evg',
    renotify: true,
    data: { url: payload.url || '/' },
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Focus the tab the player already has open rather than piling up new
      // ones (spec 0006 criterion).
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
