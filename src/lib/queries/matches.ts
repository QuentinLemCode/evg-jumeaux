/**
 * Match reads (specs 0004, 0007).
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  games,
  matchParticipants,
  matchSides,
  matches,
  pointEvents,
  teamPointEvents,
  teams,
  users,
  type GameRow,
  type MatchRow,
} from '@/db/schema';
import { canAct, isInvitationExpired } from '@/lib/domain/match-state';
import {
  isTerminal,
  type GameMode,
  type MatchSnapshot,
  type MatchStatus,
  type PointEventType,
} from '@/lib/domain/types';

export type MatchParticipantView = {
  userId: string;
  name: string;
  avatar: string;
  sideIndex: number;
  invitationStatus: 'pending' | 'accepted' | 'declined';
  respondedAt: number | null;
};

export type MatchSideView = {
  sideIndex: number;
  label: string;
  score: number | null;
  validatedAt: number | null;
  validatedBy: string | null;
  players: MatchParticipantView[];
};

export type MatchAward = {
  userId: string;
  name: string;
  type: PointEventType;
  points: number;
  detail: string;
};

/** What a settled match paid a TEAM, if it opposed the two (spec 0017). */
export type MatchTeamAward = {
  teamName: string;
  type: 'match_win' | 'margin_bonus' | 'match_reversal';
  points: number;
  detail: string;
};

export type MatchView = {
  match: MatchRow;
  game: GameRow;
  /** The status as the player should see it, with lazy expiry applied. */
  effectiveStatus: MatchStatus;
  sides: MatchSideView[];
  participants: MatchParticipantView[];
  awards: MatchAward[];
  teamAwards: MatchTeamAward[];
  snapshot: MatchSnapshot;
};

function toSnapshot(
  match: MatchRow,
  participants: MatchParticipantView[],
  sides: MatchSideView[],
  mode?: GameMode,
): MatchSnapshot {
  return {
    id: match.id,
    mode,
    status: match.status,
    sidesCount: sides.length,
    invitationExpiresAt: match.invitationExpiresAt,
    requiresScore: match.ruleRequiresScore,
    createdBy: match.createdBy,
    reportedBy: match.reportedBy,
    winningSide: match.winningSide,
    participants: participants.map((p) => ({
      userId: p.userId,
      sideIndex: p.sideIndex,
      invitationStatus: p.invitationStatus,
    })),
    sides: sides.map((s) => ({
      sideIndex: s.sideIndex,
      score: s.score,
      validatedAt: s.validatedAt,
    })),
  };
}

export async function getMatchView(
  matchId: string,
  now = Date.now(),
): Promise<MatchView | null> {
  const matchRows = await db
    .select({ match: matches, game: games })
    .from(matches)
    .innerJoin(games, eq(games.id, matches.gameId))
    .where(eq(matches.id, matchId))
    .limit(1);
  const row = matchRows[0];
  if (!row) return null;

  const [participantRows, sideRows, awardRows, teamAwardRows] = await Promise.all([
    db
      .select({
        userId: matchParticipants.userId,
        name: users.name,
        avatar: users.avatar,
        sideIndex: matchParticipants.sideIndex,
        invitationStatus: matchParticipants.invitationStatus,
        respondedAt: matchParticipants.respondedAt,
      })
      .from(matchParticipants)
      .innerJoin(users, eq(users.id, matchParticipants.userId))
      .where(eq(matchParticipants.matchId, matchId))
      .orderBy(matchParticipants.sideIndex, users.name),
    db
      .select()
      .from(matchSides)
      .where(eq(matchSides.matchId, matchId))
      .orderBy(matchSides.sideIndex),
    db
      .select({
        userId: pointEvents.userId,
        name: users.name,
        type: pointEvents.type,
        points: pointEvents.points,
        detail: pointEvents.detail,
      })
      .from(pointEvents)
      .innerJoin(users, eq(users.id, pointEvents.userId))
      .where(eq(pointEvents.matchId, matchId))
      .orderBy(users.name, pointEvents.createdAt),
    db
      .select({
        teamName: teams.name,
        type: teamPointEvents.type,
        points: teamPointEvents.points,
        detail: teamPointEvents.detail,
      })
      .from(teamPointEvents)
      .innerJoin(teams, eq(teams.id, teamPointEvents.teamId))
      .where(eq(teamPointEvents.matchId, matchId))
      .orderBy(teamPointEvents.createdAt),
  ]);

  const sides: MatchSideView[] = sideRows.map((side) => ({
    sideIndex: side.sideIndex,
    label: side.label,
    score: side.score,
    validatedAt: side.validatedAt,
    validatedBy: side.validatedBy,
    players: participantRows.filter((p) => p.sideIndex === side.sideIndex),
  }));

  const snapshot = toSnapshot(row.match, participantRows, sides, row.game.mode);

  return {
    match: row.match,
    game: row.game,
    // Lazy expiry on read: an overdue invitation is never presented as
    // joinable, even if the sweep has not run yet (spec 0004, rule 13).
    effectiveStatus: isInvitationExpired(snapshot, now) ? 'expired' : row.match.status,
    sides,
    participants: participantRows,
    awards: awardRows,
    teamAwards: teamAwardRows,
    snapshot,
  };
}

export type MatchSummary = {
  id: string;
  status: MatchStatus;
  gameName: string;
  gameIcon: string;
  gameId: string;
  createdAt: number;
  settledAt: number | null;
  invitationExpiresAt: number;
  winningSide: number | null;
  cancelReason: string | null;
  /** The player's complaint, shown to the admin who arbitrates (spec 0008, rule 2). */
  disputeReason: string | null;
  sides: { sideIndex: number; label: string; score: number | null }[];
  players: { userId: string; name: string; avatar: string; sideIndex: number }[];
};

async function hydrateSummaries(rows: { match: MatchRow; game: GameRow }[], now: number) {
  if (rows.length === 0) return [] as MatchSummary[];
  const ids = rows.map((r) => r.match.id);

  const [sideRows, playerRows] = await Promise.all([
    db
      .select()
      .from(matchSides)
      .where(inArray(matchSides.matchId, ids))
      .orderBy(matchSides.sideIndex),
    db
      .select({
        matchId: matchParticipants.matchId,
        userId: matchParticipants.userId,
        name: users.name,
        avatar: users.avatar,
        sideIndex: matchParticipants.sideIndex,
      })
      .from(matchParticipants)
      .innerJoin(users, eq(users.id, matchParticipants.userId))
      .where(inArray(matchParticipants.matchId, ids))
      .orderBy(matchParticipants.sideIndex, users.name),
  ]);

  return rows.map(({ match, game }) => ({
    id: match.id,
    status:
      match.status === 'pending' && now >= match.invitationExpiresAt
        ? ('expired' as MatchStatus)
        : match.status,
    gameName: game.name,
    gameIcon: game.icon,
    gameId: game.id,
    createdAt: match.createdAt,
    settledAt: match.settledAt,
    invitationExpiresAt: match.invitationExpiresAt,
    winningSide: match.winningSide,
    cancelReason: match.cancelReason,
    disputeReason: match.disputeReason,
    sides: sideRows
      .filter((s) => s.matchId === match.id)
      .map((s) => ({ sideIndex: s.sideIndex, label: s.label, score: s.score })),
    players: playerRows
      .filter((p) => p.matchId === match.id)
      .map((p) => ({
        userId: p.userId,
        name: p.name,
        avatar: p.avatar,
        sideIndex: p.sideIndex,
      })),
  }));
}

/** Matches happening right now, shown above the history (spec 0007, rule 2). */
export async function listLiveMatches(now = Date.now()): Promise<MatchSummary[]> {
  const rows = await db
    .select({ match: matches, game: games })
    .from(matches)
    .innerJoin(games, eq(games.id, matches.gameId))
    .where(
      or(
        inArray(matches.status, ['active', 'awaiting_validation', 'disputed']),
        and(eq(matches.status, 'pending'), sql`${matches.invitationExpiresAt} > ${now}`),
      ),
    )
    .orderBy(desc(matches.createdAt));

  return hydrateSummaries(rows, now);
}

export type HistoryFilters = {
  gameId?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
};

export async function listHistory(
  filters: HistoryFilters = {},
  now = Date.now(),
): Promise<{ matches: MatchSummary[]; hasMore: boolean; page: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 20;

  const conditions = [
    or(
      inArray(matches.status, ['completed', 'cancelled', 'expired']),
      // A pending match past its deadline is history even before the sweep
      // rewrites its status.
      and(eq(matches.status, 'pending'), sql`${matches.invitationExpiresAt} <= ${now}`),
    ),
  ];
  if (filters.gameId) conditions.push(eq(matches.gameId, filters.gameId));
  if (filters.userId) {
    conditions.push(
      sql`exists (select 1 from ${matchParticipants} mp where mp.match_id = ${matches.id} and mp.user_id = ${filters.userId})`,
    );
  }

  const rows = await db
    .select({ match: matches, game: games })
    .from(matches)
    .innerJoin(games, eq(games.id, matches.gameId))
    .where(and(...conditions))
    .orderBy(desc(sql`coalesce(${matches.settledAt}, ${matches.updatedAt})`))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);

  const hasMore = rows.length > pageSize;
  return {
    matches: await hydrateSummaries(rows.slice(0, pageSize), now),
    hasMore,
    page,
  };
}

/** The player's own matches needing their attention, for the home screen. */
export async function listMyOpenMatches(
  userId: string,
  now = Date.now(),
): Promise<MatchSummary[]> {
  const rows = await db
    .select({ match: matches, game: games })
    .from(matches)
    .innerJoin(games, eq(games.id, matches.gameId))
    .innerJoin(matchParticipants, eq(matchParticipants.matchId, matches.id))
    .where(
      and(
        eq(matchParticipants.userId, userId),
        or(
          inArray(matches.status, ['active', 'awaiting_validation', 'disputed']),
          and(eq(matches.status, 'pending'), sql`${matches.invitationExpiresAt} > ${now}`),
        ),
      ),
    )
    .orderBy(desc(matches.createdAt));

  return hydrateSummaries(rows, now);
}

export async function listDisputedMatches(now = Date.now()): Promise<MatchSummary[]> {
  const rows = await db
    .select({ match: matches, game: games })
    .from(matches)
    .innerJoin(games, eq(games.id, matches.gameId))
    .where(eq(matches.status, 'disputed'))
    .orderBy(desc(matches.reportedAt));
  return hydrateSummaries(rows, now);
}

export async function listNonTerminalMatches(now = Date.now()): Promise<MatchSummary[]> {
  const rows = await db
    .select({ match: matches, game: games })
    .from(matches)
    .innerJoin(games, eq(games.id, matches.gameId))
    .where(inArray(matches.status, ['pending', 'active', 'awaiting_validation', 'disputed']))
    .orderBy(desc(matches.createdAt));
  return hydrateSummaries(rows, now);
}

/** What the current player may do, for rendering controls only. */
export function actionsFor(view: MatchView, userId: string, now = Date.now()) {
  return canAct({ ...view.snapshot, status: view.effectiveStatus }, userId, now);
}

export function isMatchOver(view: MatchView): boolean {
  return isTerminal(view.effectiveStatus);
}
