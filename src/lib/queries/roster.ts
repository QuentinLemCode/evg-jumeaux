/**
 * Roster reads, including the "busy" rule that governs who can be invited
 * (spec 0004, rules 7-8).
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import { db } from '@/db';
import { games, matchParticipants, matches, users } from '@/db/schema';

export type RosterEntry = {
  id: string;
  name: string;
  avatar: string;
  role: 'admin' | 'user';
  teamId: string | null;
};

export type RosterEntryWithAvailability = RosterEntry & {
  busy: boolean;
  busyMatchId: string | null;
};

export async function getRoster(): Promise<RosterEntry[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      avatar: users.avatar,
      role: users.role,
      teamId: users.teamId,
    })
    .from(users)
    .orderBy(users.name);
}

/**
 * The players who cannot start or join a match right now: anyone in an
 * `active`, `awaiting_validation` or `disputed` match, plus anyone who has
 * already accepted a still-`pending` one.
 *
 * Expiry is applied lazily on read elsewhere; here a `pending` match past its
 * deadline is excluded directly so an abandoned invitation never keeps a
 * player locked out.
 *
 * **A `clash` counts for nothing here** (spec 0004, rule 7; spec 0017,
 * rule 6). The weekend's set piece runs alongside whatever is on the pétanque
 * court, so being in one never makes anybody unavailable. That is why this
 * query joins `games` at all — `matches` alone cannot see the mode, and every
 * screen that asks "who is free?" reads this one function.
 */
export async function getBusyUserIds(now = Date.now()): Promise<Map<string, string>> {
  const rows = await db
    .select({
      userId: matchParticipants.userId,
      matchId: matches.id,
      status: matches.status,
      invitationStatus: matchParticipants.invitationStatus,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
    .innerJoin(games, eq(games.id, matches.gameId))
    .where(
      and(
        ne(games.mode, 'clash'),
        inArray(matches.status, ['pending', 'active', 'awaiting_validation', 'disputed']),
        sql`(${matches.status} != 'pending' OR (${matchParticipants.invitationStatus} = 'accepted' AND ${matches.invitationExpiresAt} > ${now}))`,
      ),
    );

  const busy = new Map<string, string>();
  for (const row of rows) busy.set(row.userId, row.matchId);
  return busy;
}

export async function getRosterWithAvailability(
  now = Date.now(),
): Promise<RosterEntryWithAvailability[]> {
  const [roster, busy] = await Promise.all([getRoster(), getBusyUserIds(now)]);
  return roster.map((entry) => ({
    ...entry,
    busy: busy.has(entry.id),
    busyMatchId: busy.get(entry.id) ?? null,
  }));
}

export async function isBusy(userId: string, now = Date.now()): Promise<string | null> {
  const busy = await getBusyUserIds(now);
  return busy.get(userId) ?? null;
}
