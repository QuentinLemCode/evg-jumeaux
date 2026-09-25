/**
 * Server-side authorisation (spec 0001, spec 0008 rule 14).
 *
 * Every Server Action and every protected page starts here. Hiding a button is
 * not authorisation: these guards are the only thing standing between a
 * `user` and an admin operation (AGENTS.md §5).
 */
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db';
import { users, type UserRow } from '@/db/schema';

import { currentUserId } from './session';

export type SessionUser = Pick<UserRow, 'id' | 'name' | 'role' | 'avatar' | 'teamId'>;

export async function getCurrentUser(): Promise<SessionUser | null> {
  const id = await currentUserId();
  if (!id) return null;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      avatar: users.avatar,
      teamId: users.teamId,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  // A valid token for a player who no longer exists in the database is not a
  // session. It happens if the token outlives a database reset.
  return rows[0] ?? null;
}

/** For pages. Redirects to the login screen, remembering the destination. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = returnTo ? `/?next=${encodeURIComponent(returnTo)}` : '/';
    redirect(target);
  }
  return user;
}

export async function requireAdmin(returnTo?: string): Promise<SessionUser> {
  const user = await requireUser(returnTo);
  if (user.role !== 'admin') redirect('/leaderboard');
  return user;
}

/** Raised by actions. Never redirects: an action returns an error to the form. */
export class AuthorisationError extends Error {
  constructor(message = 'Réservé aux admins') {
    super(message);
    this.name = 'AuthorisationError';
  }
}

/** For Server Actions. Throws instead of redirecting. */
export async function requireUserAction(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorisationError('Ta session a expiré, reconnecte-toi');
  return user;
}

export async function requireAdminAction(): Promise<SessionUser> {
  const user = await requireUserAction();
  if (user.role !== 'admin') throw new AuthorisationError();
  return user;
}
