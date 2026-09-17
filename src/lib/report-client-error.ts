/**
 * Sending a browser failure to the server (spec 0011).
 *
 * Client-only, and deliberately free of any import that is not: this module is
 * pulled into the client bundle by the error boundaries and the listener.
 *
 * Three properties it exists to guarantee:
 *
 *  - **It never throws.** A failure to report an error must not be a second
 *    error. Everything is inside one try/catch that swallows.
 *  - **It survives the page going away**, via `sendBeacon` — which is exactly
 *    what happens when a guest sees a broken screen and closes the tab.
 *  - **It cannot flood.** Each distinct failure is sent once per page load,
 *    and at most five reports leave a page. A render loop otherwise turns the
 *    reporting endpoint into a denial of service against its own backend.
 */
const ENDPOINT = '/api/client-errors';
const MAX_PER_PAGE_LOAD = 5;

export type ClientErrorKind = 'render' | 'unhandled' | 'rejection' | 'sw';

const alreadySent = new Set<string>();
let sentCount = 0;

/** Truncated here as well as validated server-side: a huge POST is wasteful. */
function trim(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack };
  }
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error).slice(0, 200) };
  } catch {
    return { message: 'Erreur non sérialisable' };
  }
}

export function reportClientError(kind: ClientErrorKind, error: unknown): void {
  try {
    if (typeof window === 'undefined') return;

    const { message, stack } = describe(error);
    if (!message) return;

    // The grouping key here is only for per-page-load deduplication; the
    // canonical fingerprint is computed server-side, where the hash lives.
    const key = `${kind}:${message}:${stack?.split('\n')[1]?.trim() ?? ''}`;
    if (alreadySent.has(key)) return;
    if (sentCount >= MAX_PER_PAGE_LOAD) return;
    alreadySent.add(key);
    sentCount += 1;

    const body = JSON.stringify({
      kind,
      message: trim(message, 500),
      stack: trim(stack, 8000) ?? null,
      // The route, not the full URL: a query string can carry a `next=`
      // destination, and there is no reason to send more than the route.
      path: window.location.pathname,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    });

    // sendBeacon is the only transport that outlives the page. It sends
    // text/plain, which the handler expects.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(ENDPOINT, body)) return;
    }

    void fetch(ENDPOINT, {
      method: 'POST',
      body,
      keepalive: true,
      headers: { 'content-type': 'application/json' },
    }).catch(() => {
      // Offline, or the endpoint is down. Nothing useful to do, and nothing
      // the guest should ever see.
    });
  } catch {
    // Reporting an error must never break the page.
  }
}
