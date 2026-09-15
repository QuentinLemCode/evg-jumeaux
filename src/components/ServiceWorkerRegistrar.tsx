'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (spec 0009, rules 12-15).
 *
 * `updateViaCache: 'none'` plus the no-store header on /sw.js is what makes a
 * deployment reach an installed PWA on the next navigation instead of hours
 * later.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {
        // A browser without service worker support still gets the whole app;
        // it just gets no push and no offline page.
      });
  }, []);

  return null;
}
