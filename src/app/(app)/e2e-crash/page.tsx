import { notFound } from 'next/navigation';

/**
 * A route that throws during render, so the error boundary can be tested
 * (spec 0011, acceptance criteria).
 *
 * Testing an error boundary requires something that errors, and there is no
 * way to make a real component fail on demand from outside. The alternative
 * was an untested boundary, which is worse than a five-line route.
 *
 * It is inert unless `E2E_CRASH_ROUTE=1`, which only
 * `playwright.config.ts` sets. In every other environment — including
 * production — this is a 404, and the default is the safe one: the throw needs
 * an explicit opt-in, the 404 needs nothing.
 */
export const dynamic = 'force-dynamic';

export default function CrashPage() {
  if (process.env.E2E_CRASH_ROUTE !== '1') notFound();
  throw new Error('Crash volontaire pour tester la remontée des erreurs');
}
