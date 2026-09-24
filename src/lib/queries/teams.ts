/**
 * Team reads (spec 0017, rules 25-29).
 *
 * Totals are summed from the team ledger on every read, exactly as the player
 * leaderboard is summed from the player ledger. The two are NEVER added
 * together: a team total added to each of its members is a constant per team,
 * so it cannot reorder anybody within a team and it flips both teams
 * wholesale — turning the player leaderboard into a measure of which team you
 * joined (rule 26).
 */
import { asc, eq, isNotNull, sql } from 'drizzle-orm';

import { db, type Db, type Tx } from '@/db';
import { pointEvents, teamPointEvents, teams, users } from '@/db/schema';
import { rankTeamStandings, type TeamSize } from '@/lib/domain/teams';

export type TeamMember = {
  userId: string;
  name: string;
  avatar: string;
  points: number;
  isCaptain: boolean;
};

export type TeamStanding = {
  teamId: string;
  slug: string;
  name: string;
  accent: string;
  points: number;
  playerCount: number;
  matchesWon: number;
  rank: number;
  captainId: string | null;
  members: TeamMember[];
};

export type PlayerTeam = {
  teamId: string;
  slug: string;
  name: string;
  accent: string;
  isCaptain: boolean;
};

/**
 * The two teams with their current size — what the choice screen ranks on.
 * The authoritative count is the one the transaction re-reads; this one only
 * decides what the screen offers (rule 16).
 */
export type TeamOption = TeamSize & { slug: string; accent: string };

/** Which players belong to which team. The one definition of that link. */
export const TEAM_MEMBERSHIP_JOIN = eq(users.teamId, teams.id);

export const TEAM_SIZE_FIELDS = {
  teamId: teams.id,
  slug: teams.slug,
  name: teams.name,
  accent: teams.accent,
  // `count(column)` and not `count(*)`: the LEFT JOIN yields one all-null row
  // for a team nobody has joined, and counting a column ignores it, so an
  // empty team reports 0 rather than 1.
  memberCount: sql<number>`count(${users.id})`,
};

/**
 * How many players each team has, as ONE query — read by the screen that
 * offers the choice and, inside its transaction, by the rule that enforces
 * the cap (rules 12-14). Two spellings of this could disagree, and the
 * one that decides must be the one that is displayed.
 *
 * A LEFT JOIN rather than a correlated subquery, and that is not a matter of
 * taste. Drizzle renders a SINGLE-table select's identifiers **unqualified**,
 * so this:
 *
 *     sql`(select count(*) from ${users} where ${users.teamId} = ${teams.id})`
 *
 * came out as `where "team_id" = "id"` — and inside that subquery `users` is
 * in scope, so both names bound to `users`. It counted the players whose team
 * is their own id, which is nobody: every team reported 0 members, the two
 * always looked level, and the balance rule therefore never refused anything.
 * A join makes Drizzle qualify every identifier itself, so there is no
 * hand-written table name left to get wrong. `teams.sql.test.ts` holds the
 * shape to it.
 */
export function teamSizeQuery(runner: Db | Tx) {
  return runner
    .select(TEAM_SIZE_FIELDS)
    .from(teams)
    .leftJoin(users, TEAM_MEMBERSHIP_JOIN)
    .groupBy(teams.id)
    .orderBy(asc(teams.name));
}

export async function listTeams(): Promise<TeamOption[]> {
  const rows = await teamSizeQuery(db);
  return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
}

/**
 * How many players the weekend has. The cap on a team is half of it, rounded
 * up (rule 12) — derived from the roster rather than written down, because
 * the next weekend will not have fifteen.
 */
export async function countPlayers(): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)` }).from(users);
  return Number(rows[0]?.count ?? 0);
}

/** A player's team, for the gate and for their profile (rules 11 and 29). */
export async function getPlayerTeam(userId: string): Promise<PlayerTeam | null> {
  const rows = await db
    .select({
      teamId: teams.id,
      slug: teams.slug,
      name: teams.name,
      accent: teams.accent,
      captainId: teams.captainId,
    })
    .from(users)
    .innerJoin(teams, eq(teams.id, users.teamId))
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    teamId: row.teamId,
    slug: row.slug,
    name: row.name,
    accent: row.accent,
    isCaptain: row.captainId === userId,
  };
}

/** The team a player captains, if any — a captain is never offered a choice. */
export async function getCaptainedTeam(userId: string): Promise<PlayerTeam | null> {
  const rows = await db
    .select({
      teamId: teams.id,
      slug: teams.slug,
      name: teams.name,
      accent: teams.accent,
    })
    .from(teams)
    .where(eq(teams.captainId, userId))
    .limit(1);
  const row = rows[0];
  return row ? { ...row, isCaptain: true } : null;
}

/**
 * The team standings (rules 25, 27, 28).
 *
 * "Matches won" is the number of distinct matches whose rows for that team sum
 * above zero — so a reversal, which cancels the award exactly, removes the win
 * along with the points. It is why the team ledger holds three types and no
 * more.
 */
export async function getTeamStandings(): Promise<TeamStanding[]> {
  const [rows, totals, wins, roster, ledger] = await Promise.all([
    db
      .select({
        teamId: teams.id,
        slug: teams.slug,
        name: teams.name,
        accent: teams.accent,
        captainId: teams.captainId,
      })
      .from(teams)
      .orderBy(asc(teams.name)),
    db
      .select({
        teamId: teamPointEvents.teamId,
        total: sql<number>`coalesce(sum(${teamPointEvents.points}), 0)`,
      })
      .from(teamPointEvents)
      .groupBy(teamPointEvents.teamId),
    // One row per (team, match), summed. Counting the positive ones in
    // JavaScript rather than in a nested SQL query keeps rule 28 readable,
    // and there are two teams and a few dozen matches.
    db
      .select({
        teamId: teamPointEvents.teamId,
        matchId: teamPointEvents.matchId,
        total: sql<number>`coalesce(sum(${teamPointEvents.points}), 0)`,
      })
      .from(teamPointEvents)
      .groupBy(teamPointEvents.teamId, teamPointEvents.matchId),
    db
      .select({
        userId: users.id,
        name: users.name,
        avatar: users.avatar,
        teamId: users.teamId,
      })
      .from(users)
      .orderBy(asc(users.name)),
    db
      .select({
        userId: pointEvents.userId,
        total: sql<number>`coalesce(sum(${pointEvents.points}), 0)`,
      })
      .from(pointEvents)
      .groupBy(pointEvents.userId),
  ]);

  const pointsByTeam = new Map(totals.map((row) => [row.teamId, Number(row.total)]));
  const winsByTeam = new Map<string, number>();
  for (const row of wins) {
    if (Number(row.total) <= 0) continue;
    winsByTeam.set(row.teamId, (winsByTeam.get(row.teamId) ?? 0) + 1);
  }
  const pointsByUser = new Map(ledger.map((row) => [row.userId, Number(row.total)]));

  const standings = rows.map((team) => {
    const members: TeamMember[] = roster
      .filter((player) => player.teamId === team.teamId)
      .map((player) => ({
        userId: player.userId,
        name: player.name,
        avatar: player.avatar,
        points: pointsByUser.get(player.userId) ?? 0,
        isCaptain: player.userId === team.captainId,
      }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'fr'));

    return {
      teamId: team.teamId,
      slug: team.slug,
      name: team.name,
      accent: team.accent,
      captainId: team.captainId,
      points: pointsByTeam.get(team.teamId) ?? 0,
      matchesWon: winsByTeam.get(team.teamId) ?? 0,
      playerCount: members.length,
      members,
    };
  });

  return rankTeamStandings(standings);
}

export type ClashMember = {
  id: string;
  name: string;
  avatar: string;
};

export type ClashSide = {
  sideIndex: number;
  teamId: string;
  teamName: string;
  accent: string;
  members: ClashMember[];
};

/**
 * The line-up of a clash: both teams in full, the creator's own team on side 1
 * (spec 0017, rule 3, and spec 0004, rule 2 — the creator is a participant).
 *
 * Returns null when the caller belongs to no team, which is the one case a
 * clash cannot be built from: its sides ARE the two teams, and the creator
 * has to be in one of them.
 *
 * Availability is deliberately absent: a clash runs alongside everything
 * else, so who is mid-match is not this screen's business (rule 6).
 */
export async function getClashLineup(creatorId: string): Promise<ClashSide[] | null> {
  const [rows, roster] = await Promise.all([
    db
      .select({ teamId: teams.id, name: teams.name, accent: teams.accent })
      .from(teams)
      .orderBy(asc(teams.name)),
    db
      .select({
        id: users.id,
        name: users.name,
        avatar: users.avatar,
        teamId: users.teamId,
      })
      .from(users)
      .where(isNotNull(users.teamId))
      .orderBy(asc(users.name)),
  ]);

  if (rows.length !== 2) return null;
  const mine = roster.find((player) => player.id === creatorId);
  if (!mine) return null;

  // The creator's team leads, so the creator sits on side 1 as every other
  // match's creator does.
  const ordered = [...rows].sort((a, b) =>
    a.teamId === mine.teamId ? -1 : b.teamId === mine.teamId ? 1 : 0,
  );

  return ordered.map((team, index) => ({
    sideIndex: index + 1,
    teamId: team.teamId,
    teamName: team.name,
    accent: team.accent,
    members: roster
      .filter((player) => player.teamId === team.teamId)
      .map((player) => ({
        id: player.id,
        name: player.name,
        avatar: player.avatar,
      })),
  }));
}
