/**
 * Session issuing and reading (spec 0001).
 *
 * The cookie carries a signed JWT whose only claim is the player's id. The
 * role is deliberately NOT in the token: it is read from the database on every
 * request, so promoting someone to admin in the seed takes effect immediately
 * instead of after their 4-day session expires.
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';

import { SESSION_COOKIE } from './cookie';
import { SESSION_TTL_MS } from '@/lib/domain/types';

export { SESSION_COOKIE } from './cookie';

function secret(): Uint8Array {
  return new TextEncoder().encode(env().AUTH_SECRET);
}

export async function createSessionToken(userId: string, now = Date.now()): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(Math.floor(now / 1000))
    // Fixed, non-sliding expiry: exactly 96 hours after login (rule 5).
    .setExpirationTime(Math.floor((now + SESSION_TTL_MS) / 1000))
    .sign(secret());
}

export async function readSessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    // An expired token, a tampered token and a token signed with another
    // secret are all indistinguishable from no session (rules 8, 12).
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await createSessionToken(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function currentUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionToken(token);
}
