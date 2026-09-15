/**
 * Game catalog reads (spec 0003).
 */
import { desc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { games, matches, type GameRow } from '@/db/schema';

export type GameWithUsage = GameRow & { matchCount: number };

/**
 * Active games first, then by how much the game is actually being played. The
 * weekend's favourites float to the top of the list without anybody
 * configuring anything (spec 0003, rule 6).
 */
export async function listGames(): Promise<GameWithUsage[]> {
  const rows = await db
    .select({
      game: games,
      matchCount: sql<number>`count(${matches.id})`,
    })
    .from(games)
    .leftJoin(matches, eq(matches.gameId, games.id))
    .groupBy(games.id)
    .orderBy(desc(games.isActive), desc(sql`count(${matches.id})`), games.name);

  return rows.map((row) => ({ ...row.game, matchCount: Number(row.matchCount) }));
}

export async function getGameById(id: string): Promise<GameRow | null> {
  const rows = await db.select().from(games).where(eq(games.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getGameBySlug(slug: string): Promise<GameRow | null> {
  const rows = await db.select().from(games).where(eq(games.slug, slug)).limit(1);
  return rows[0] ?? null;
}
