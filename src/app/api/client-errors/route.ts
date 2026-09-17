import { sql } from 'drizzle-orm';
import { headers } from 'next/headers';

import { db } from '@/db';
import { clientErrors } from '@/db/schema';
import { currentUserId } from '@/lib/auth/session';
import {
  CLIENT_ERROR_KINDS,
  CLIENT_ERROR_LIMITS,
  fingerprintError,
  summariseBrowser,
  validateReport,
  type ClientErrorKind,
} from '@/lib/domain/client-errors';
import { createWindowLimiter } from '@/lib/throttle';

/**
 * Where browser failures land (spec 0011).
 *
 * A route handler and not a Server Action, for two reasons: `navigator
 * .sendBeacon` can only POST to a URL, and it is the only transport that
 * survives the page being closed — which is exactly what a guest does after a
 * crash. And a Server Action can fail for the same reason the error did.
 *
 * No session required (rule 5): a broken session is one of the things this is
 * meant to catch. Hence the rate limit below.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const limiter = createWindowLimiter({ limit: 20, windowMs: 10 * 60_000 });

function clientIp(headerList: Headers): string {
  // Behind the Cloudflare tunnel and Caddy, the real address arrives in a
  // header. Falling back to a constant means everyone shares one bucket,
  // which is the safe direction to be wrong in.
  return (
    headerList.get('cf-connecting-ip') ??
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function isKind(value: unknown): value is ClientErrorKind {
  return typeof value === 'string' && (CLIENT_ERROR_KINDS as readonly string[]).includes(value);
}

export async function POST(request: Request): Promise<Response> {
  const headerList = await headers();

  if (!limiter.allow(clientIp(headerList))) {
    return new Response(null, { status: 429 });
  }

  // sendBeacon sends text/plain unless given a typed Blob, so parse the body
  // as text and then as JSON rather than trusting the content type.
  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > CLIENT_ERROR_LIMITS.stack + 2_000) {
      return new Response(null, { status: 400 });
    }
    payload = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }

  if (typeof payload !== 'object' || payload === null) {
    return new Response(null, { status: 400 });
  }
  const body = payload as Record<string, unknown>;

  if (!isKind(body.kind) || typeof body.message !== 'string' || typeof body.path !== 'string') {
    return new Response(null, { status: 400 });
  }

  const report = {
    kind: body.kind,
    message: body.message,
    stack: typeof body.stack === 'string' ? body.stack : null,
    path: body.path,
    viewport: typeof body.viewport === 'string' ? body.viewport : null,
  };

  if (validateReport(report).length > 0) {
    return new Response(null, { status: 400 });
  }

  // The identity comes from the cookie, never from the body: a client-supplied
  // user id is a client-controlled one, and an error report is the last place
  // to trust it (rule 3).
  const userId = await currentUserId();
  const userAgent = headerList.get('user-agent')?.slice(0, CLIENT_ERROR_LIMITS.userAgent) ?? null;

  const now = Date.now();
  const fingerprint = fingerprintError(report);

  try {
    await db
      .insert(clientErrors)
      .values({
        id: crypto.randomUUID(),
        fingerprint,
        kind: report.kind,
        message: report.message,
        stack: report.stack,
        path: report.path,
        // Stamped by the server: it knows which build is answering, and a
        // build-time constant baked into the client bundle could disagree.
        appCommit: process.env.GIT_COMMIT ?? null,
        viewport: report.viewport,
        occurrences: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        lastUserId: userId,
        lastUserAgent: userAgent,
        lastBrowser: summariseBrowser(userAgent),
        resolvedAt: null,
        alertedAt: null,
      })
      .onConflictDoUpdate({
        target: clientErrors.fingerprint,
        set: {
          // `message` is deliberately absent: a group keeps the first message
          // it was seen with, so its label does not move under the reader
          // (rule 19). The stack, path and viewport follow the latest
          // occurrence, because that is the one you would debug.
          occurrences: sql`${clientErrors.occurrences} + 1`,
          lastSeenAt: now,
          lastUserId: userId,
          lastUserAgent: userAgent,
          lastBrowser: summariseBrowser(userAgent),
          stack: report.stack,
          path: report.path,
          appCommit: process.env.GIT_COMMIT ?? null,
          viewport: report.viewport,
          // A bug that comes back is news, so it stops being resolved. But
          // `alertedAt` is deliberately NOT cleared: one alert per group, not
          // one per occurrence (rule 21).
          resolvedAt: null,
        },
      });
  } catch (error) {
    console.error('client-errors: could not record a report', error);
    return new Response(null, { status: 500 });
  }

  // Nothing to say back. The client is fire-and-forget by design.
  return new Response(null, { status: 204 });
}
