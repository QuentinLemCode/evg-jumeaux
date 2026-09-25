/**
 * Player profiles (spec 0007, rules 9-14).
 */
import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { games, matchParticipants, matches, pointEvents, users } from '@/db/schema';

import { getStandings, type Standing } from './leaderboard';
import { isBusy } from './roster';
import { listHistory, type MatchSummary } from './matches';

import type { PointEventType } from '@/lib/domain/types';

export type LedgerEntry = {
  id: string;
  type: PointEventType;
  points: number;
  detail: string;
  matchId: string | null;
  createdAt: number;
  createdByName: string | null;
};

export type GameBreakdown = {
  gameId: string;
  gameName: string;
  gameIcon: string;
  played: number;
  won: number;
};

export type PlayerProfile = {
  standing: Standing;
  role: 'admin' | 'user';
  busyMatchId: string | null;
  winRate: number | null;
  ledger: LedgerEntry[];
  perGame: GameBreakdown[];
  history: MatchSummary[];
};

export async function getPlayerProfile(
  userId: string,
  now = Date.now(),
): Promise<PlayerProfile | null> {
  const rows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const player = rows[0];
  if (!player) return null;

  const creators = db.select().from(users).as('creators');

  const [standings, ledger, perGame, busyMatchId, history] = await Promise.all([
    getStandings(),
    db
      .select({
        id: pointEvents.id,
        type: pointEvents.type,
        points: pointEvents.points,
        detail: pointEvents.detail,
        matchId: pointEvents.matchId,
        createdAt: pointEvents.createdAt,
        createdByName: creators.name,
      })
      .from(pointEvents)
      .leftJoin(creators, eq(creators.id, pointEvents.createdBy))
      .where(eq(pointEvents.userId, userId))
      .orderBy(desc(pointEvents.createdAt)),
    db
      .select({
        gameId: games.id,
        gameName: games.name,
        gameIcon: games.icon,
        played: sql<number>`count(*)`,
        won: sql<number>`sum(case when ${matches.winningSide} = ${matchParticipants.sideIndex} then 1 else 0 end)`,
      })
      .from(matchParticipants)
      .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
      .innerJoin(games, eq(games.id, matches.gameId))
      .where(
        and(
          eq(matchParticipants.userId, userId),
          eq(matches.status, 'completed'),
          eq(matchParticipants.invitationStatus, 'accepted'),
        ),
      )
      .groupBy(games.id)
      .orderBy(desc(sql`count(*)`)),
    isBusy(userId, now),
    listHistory({ userId, pageSize: 20 }, now),
  ]);

  const standing = standings.find((s) => s.userId === userId);
  if (!standing) return null;

  return {
    standing,
    role: player.role,
    busyMatchId,
    winRate: standing.played > 0 ? standing.wins / standing.played : null,
    ledger,
    perGame: perGame.map((g) => ({
      gameId: g.gameId,
      gameName: g.gameName,
      gameIcon: g.gameIcon,
      played: Number(g.played),
      won: Number(g.won),
    })),
    history: history.matches,
  };
}
