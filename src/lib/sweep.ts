/**
 * Expires overdue pending invitations (spec 0004, rule 13).
 *
 * Runs once a minute from the `sweeper` container. It is a backstop, not the
 * mechanism: every read also applies expiry lazily, so a missed sweep degrades
 * to "the status column is briefly stale" and never to "a dead invitation
 * looks joinable".
 */
import { and, eq, lte } from 'drizzle-orm';

import { db } from './../db';
import { matches } from './../db/schema';
import { applyMatchAction } from './matches/apply';

export async function sweepExpiredMatches(now = Date.now()): Promise<string[]> {
  const overdue = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.status, 'pending'), lte(matches.invitationExpiresAt, now)));

  const expired: string[] = [];
  for (const { id } of overdue) {
    const result = await applyMatchAction(id, { type: 'expire' }, now);
    if (result.ok) expired.push(id);
  }
  return expired;
}
