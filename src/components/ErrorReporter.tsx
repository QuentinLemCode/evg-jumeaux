'use client';

import { useEffect } from 'react';

import { reportClientError } from '@/lib/report-client-error';

/**
 * Catches what an error boundary cannot (spec 0011, rule 1).
 *
 * A React boundary only sees failures during render. An exception in an event
 * handler, a rejected promise nobody awaited, a service worker that throws —
 * none of those reach a boundary, and all of them are how this app actually
 * breaks: a Server Action failing on patchy 4G is a rejected promise.
 *
 * Rendered from the ROOT layout, so the login screen is covered too. A crash
 * there is precisely the one that would otherwise never be reported, because
 * nobody is logged in to report it.
 */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientError('unhandled', event.error ?? event.message);
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      reportClientError('rejection', event.reason);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
