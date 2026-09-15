'use server';

/**
 * Login and logout (spec 0001).
 */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/db';
import { users } from '@/db/schema';
import { checkRateLimit, clearFailures, recordFailure } from '@/lib/auth/rate-limit';
import { clearSessionCookie, setSessionCookie } from '@/lib/auth/session';
import { waitLabel } from '@/lib/format';

/**
 * Login has a structured failure the others do not: a lockout carries the
 * remaining wait, so the screen can disable the keypad and tick it down
 * (spec 0001, rule 12).
 */
export type LoginOutcome =
  | { ok: true; next: string }
  | { ok: false; message: string; retryInMs?: number };

const loginSchema = z.object({
  userId: z.string().min(1),
  pin: z.string().regex(/^\d{6}$/, 'Le code fait 6 chiffres'),
  next: z.string().optional(),
});

export async function login(formData: FormData): Promise<LoginOutcome> {
  try {
    const parsed = loginSchema.safeParse({
      userId: formData.get('userId'),
      pin: formData.get('pin'),
      next: formData.get('next') ?? undefined,
    });
    if (!parsed.success) return { ok: false, message: 'Code incorrect' };

    const { userId, pin } = parsed.data;

    // Checked BEFORE the hash comparison, so a locked-out attempt never
    // reaches the PIN at all and costs nothing (spec 0001, rule 11).
    const limit = checkRateLimit(userId);
    if (limit.blocked) {
      return {
        ok: false,
        message: `Trop de tentatives. Réessaie dans ${waitLabel(limit.retryInMs)}.`,
        retryInMs: limit.retryInMs,
      };
    }

    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = rows[0];

    // Compare even when the player does not exist, so the response time does
    // not reveal which ids are real.
    const hash = user?.pinHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const valid = await bcrypt.compare(pin, hash);

    if (!user || !valid) {
      recordFailure(userId);
      // Re-read the ladder so the very attempt that triggered a lockout says
      // so, instead of letting the player discover it on the next try.
      const after = checkRateLimit(userId);
      if (after.blocked) {
        return {
          ok: false,
          message: `Code incorrect. Réessaie dans ${waitLabel(after.retryInMs)}.`,
          retryInMs: after.retryInMs,
        };
      }
      return { ok: false, message: 'Code incorrect' };
    }

    clearFailures(userId);
    await setSessionCookie(user.id);

    const next = parsed.data.next;
    const safeNext =
      next && next.startsWith('/') && !next.startsWith('//') ? next : '/leaderboard';
    return { ok: true, next: safeNext };
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthorisationError') {
      return { ok: false, message: error.message };
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_')
    ) {
      throw error;
    }
    console.error('login failed', error);
    return { ok: false, message: 'Une erreur est survenue. Réessaie.' };
  }
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect('/');
}
