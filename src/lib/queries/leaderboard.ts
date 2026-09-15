/**
 * The leaderboard (spec 0005, rules 15-18).
 *
 * Totals are summed from the point ledger on every read. There is no cached
 * total and no `users.points` column: a few dozen players and a few hundred
 * matches do not justify a cache, and every cache is a chance to show somebody
 * a score that is wrong.
 */
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { matchParticipants, matches, pointEvents, users } from '@/db/schema';
import { rankStandings } from '@/lib/domain/scoring';

export type Standing = {
  userId: string;
  name: string;
  avatar: string;
  points: number;
  wins: number;
  losses: number;
  played: number;
  rank: number;
};

export async function getStandings(): Promise<Standing[]> {
  const [roster, totals, records] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, avatar: users.avatar })
      .from(users)
      .orderBy(users.name),
    db
      .select({
        userId: pointEvents.userId,
        total: sql<number>`coalesce(sum(${pointEvents.points}), 0)`,
      })
      .from(pointEvents)
      .groupBy(pointEvents.userId),
    db
      .select({
        userId: matchParticipants.userId,
        played: sql<number>`count(*)`,
        wins: sql<number>`sum(case when ${matches.winningSide} = ${matchParticipants.sideIndex} then 1 else 0 end)`,
      })
      .from(matchParticipants)
      .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
      .where(
        and(
          eq(matches.status, 'completed'),
          eq(matchParticipants.invitationStatus, 'accepted'),
        ),
      )
      .groupBy(matchParticipants.userId),
  ]);

  const pointsByUser = new Map(totals.map((t) => [t.userId, Number(t.total)]));
  const recordByUser = new Map(
    records.map((r) => [r.userId, { played: Number(r.played), wins: Number(r.wins) }]),
  );

  return rankStandings(
    roster.map((player) => {
      const record = recordByUser.get(player.id) ?? { played: 0, wins: 0 };
      return {
        userId: player.id,
        name: player.name,
        avatar: player.avatar,
        points: pointsByUser.get(player.id) ?? 0,
        played: record.played,
        wins: record.wins,
        losses: record.played - record.wins,
      };
    }),
  );
}
