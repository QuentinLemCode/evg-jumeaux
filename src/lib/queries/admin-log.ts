/**
 * The public admin log (spec 0008, rules 15-21).
 *
 * Derived from what is already recorded — `point_events` rows an admin
 * created, and matches an admin settled, cancelled or force-expired. There is
 * deliberately no audit table: two records of the same event eventually
 * disagree, and the one people must be able to trust is the one the points
 * actually come from.
 */
import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  games,
  matchSides,
  matches,
  pointEvents,
  teamMoves,
  teams,
  users,
} from '@/db/schema';

export const ADMIN_LOG_TYPES = [
  'adjustment',
  'dispute_settled',
  'match_cancelled',
  'force_expired',
  'team_move',
] as const;

export type AdminLogType = (typeof ADMIN_LOG_TYPES)[number];

export const ADMIN_LOG_LABELS: Record<AdminLogType, string> = {
  adjustment: 'Points ajustés',
  dispute_settled: 'Contestation tranchée',
  match_cancelled: 'Partie annulée',
  force_expired: 'Invitation expirée',
  team_move: 'Joueur déplacé',
};

export type AdminLogEntry = {
  key: string;
  type: AdminLogType;
  at: number;
  adminName: string;
  adminId: string | null;
  /** Signed total points moved by this intervention. 0 when it moved none. */
  points: number;
  /** How many players' totals it touched. */
  affected: number;
  /** The admin's stated reason, when the operation records one. */
  reason: string | null;
  /** The derived fact, shown when there is no stated reason. */
  derived: string | null;
  subject: string;
  /**
   * A short factual suffix to the subject, where the subject alone does not
   * say what changed — a team move's «from → to» (spec 0017, rule 15).
   */
  trajectory: string | null;
  targetUserId: string | null;
  matchId: string | null;
  gameName: string | null;
  gameIcon: string | null;
};

function sideSummary(
  sides: { sideIndex: number; label: string; score: number | null }[],
): string {
  const ordered = [...sides].sort((a, b) => a.sideIndex - b.sideIndex);
  const hasScores = ordered.every((s) => s.score !== null);
  if (hasScores) {
    return ordered.map((s) => `${s.label} ${s.score}`).join(' – ');
  }
  return ordered.map((s) => s.label).join(' vs ');
}

export async function listAdminLog(
  filter?: AdminLogType,
): Promise<AdminLogEntry[]> {
  const admins = db.select().from(users).as('admins');
  const targets = db.select().from(users).as('targets');
  const fromTeams = db.select().from(teams).as('from_teams');
  const toTeams = db.select().from(teams).as('to_teams');

  // --- manual adjustments ---------------------------------------------------
  const adjustmentRows = await db
    .select({
      id: pointEvents.id,
      at: pointEvents.createdAt,
      points: pointEvents.points,
      reason: pointEvents.detail,
      adminId: pointEvents.createdBy,
      adminName: admins.name,
      targetUserId: pointEvents.userId,
      targetName: targets.name,
    })
    .from(pointEvents)
    .leftJoin(admins, eq(admins.id, pointEvents.createdBy))
    .innerJoin(targets, eq(targets.id, pointEvents.userId))
    .where(eq(pointEvents.type, 'admin_adjustment'))
    .orderBy(desc(pointEvents.createdAt));

  // --- players moved between teams (spec 0017, rule 15) --------------------
  //
  // The only intervention that writes no point and touches no match, which is
  // exactly why it needs rows of its own: two columns on the player would
  // have kept the last move and forgotten every one before it.
  const moveRows = await db
    .select({
      id: teamMoves.id,
      at: teamMoves.createdAt,
      reason: teamMoves.reason,
      adminId: teamMoves.movedBy,
      adminName: admins.name,
      targetUserId: teamMoves.userId,
      targetName: targets.name,
      fromName: fromTeams.name,
      toName: toTeams.name,
    })
    .from(teamMoves)
    .leftJoin(admins, eq(admins.id, teamMoves.movedBy))
    .innerJoin(targets, eq(targets.id, teamMoves.userId))
    .leftJoin(fromTeams, eq(fromTeams.id, teamMoves.fromTeamId))
    .innerJoin(toTeams, eq(toTeams.id, teamMoves.toTeamId))
    .orderBy(desc(teamMoves.createdAt));

  // --- interventions on matches --------------------------------------------
  const matchRows = await db
    .select({
      match: matches,
      gameName: games.name,
      gameIcon: games.icon,
      settledByName: admins.name,
      cancelledByName: targets.name,
    })
    .from(matches)
    .innerJoin(games, eq(games.id, matches.gameId))
    .leftJoin(admins, eq(admins.id, matches.settledBy))
    .leftJoin(targets, eq(targets.id, matches.cancelledBy))
    .where(
      or(
        isNotNull(matches.settledBy),
        isNotNull(matches.forcedBy),
        // A cancellation only counts as an intervention once a result
        // existed: cancelling a pending or active match is an ordinary player
        // action and is already visible in the history (spec 0008, rule 18).
        and(isNotNull(matches.cancelledBy), isNotNull(matches.reportedAt)),
      ),
    );

  const matchIds = matchRows.map((row) => row.match.id);

  const [sideRows, movementRows, forcedByRows] = await Promise.all([
    matchIds.length
      ? db.select().from(matchSides).where(inArray(matchSides.matchId, matchIds))
      : Promise.resolve([]),
    matchIds.length
      ? db
          .select({
            matchId: pointEvents.matchId,
            type: pointEvents.type,
            points: pointEvents.points,
            userId: pointEvents.userId,
          })
          .from(pointEvents)
          .where(inArray(pointEvents.matchId, matchIds))
      : Promise.resolve([]),
    matchIds.length
      ? db
          .select({ matchId: matches.id, name: users.name, id: users.id })
          .from(matches)
          .innerJoin(users, eq(users.id, matches.forcedBy))
          .where(inArray(matches.id, matchIds))
      : Promise.resolve([]),
  ]);

  const forcedBy = new Map(forcedByRows.map((r) => [r.matchId, r]));

  const entries: AdminLogEntry[] = adjustmentRows.map((row) => ({
    key: `adjustment:${row.id}`,
    type: 'adjustment' as const,
    at: row.at,
    adminName: row.adminName ?? 'Un admin',
    adminId: row.adminId,
    points: row.points,
    affected: 1,
    reason: row.reason,
    derived: null,
    subject: row.targetName,
    trajectory: null,
    targetUserId: row.targetUserId,
    matchId: null,
    gameName: null,
    gameIcon: null,
  }));

  entries.push(
    ...moveRows.map((row) => ({
      key: `team-move:${row.id}`,
      type: 'team_move' as const,
      at: row.at,
      adminName: row.adminName ?? 'Un admin',
      adminId: row.adminId,
      // A move carries no points: the player keeps theirs and the old team
      // keeps what it earned (spec 0017, rule 18).
      points: 0,
      affected: 1,
      reason: row.reason,
      derived: null,
      subject: row.targetName,
      trajectory: row.fromName
        ? `${row.fromName} → ${row.toName}`
        : `sans équipe → ${row.toName}`,
      targetUserId: row.targetUserId,
      matchId: null,
      gameName: null,
      gameIcon: null,
    })),
  );

  for (const row of matchRows) {
    const match = row.match;
    const sides = sideRows
      .filter((s) => s.matchId === match.id)
      .map((s) => ({ sideIndex: s.sideIndex, label: s.label, score: s.score }));
    const subject = sideSummary(sides);
    const movements = movementRows.filter((m) => m.matchId === match.id);

    const sumOf = (types: string[]) => {
      const rows = movements.filter((m) => types.includes(m.type));
      return {
        total: rows.reduce((sum, m) => sum + m.points, 0),
        affected: new Set(rows.map((m) => m.userId)).size,
      };
    };

    if (match.settledBy) {
      const awarded = sumOf(['match_win', 'margin_bonus']);
      entries.push({
        key: `settled:${match.id}`,
        type: 'dispute_settled',
        at: match.settledAt ?? match.updatedAt,
        adminName: row.settledByName ?? 'Un admin',
        adminId: match.settledBy,
        points: awarded.total,
        affected: awarded.affected,
        reason: match.resolutionNote,
        derived: match.resolutionNote ? null : 'Décision enregistrée sans motif',
        subject,
        trajectory: null,
        targetUserId: null,
        matchId: match.id,
        gameName: row.gameName,
        gameIcon: row.gameIcon,
      });
    }

    if (match.cancelledBy && match.reportedAt) {
      const reversed = sumOf(['match_reversal']);
      entries.push({
        key: `cancelled:${match.id}`,
        type: 'match_cancelled',
        at: match.updatedAt,
        adminName: row.cancelledByName ?? 'Un admin',
        adminId: match.cancelledBy,
        points: reversed.total,
        affected: reversed.affected,
        reason: match.cancelReason,
        derived: reversed.total === 0 ? 'Aucun point n’avait été attribué' : null,
        subject,
        trajectory: null,
        targetUserId: null,
        matchId: match.id,
        gameName: row.gameName,
        gameIcon: row.gameIcon,
      });
    }

    const forced = forcedBy.get(match.id);
    if (forced) {
      entries.push({
        key: `forced:${match.id}`,
        type: 'force_expired',
        at: match.updatedAt,
        adminName: forced.name,
        adminId: forced.id,
        points: 0,
        affected: 0,
        reason: null,
        // A force-expiry records no reason, so the entry states the fact
        // instead (spec 0008, rule 18).
        derived: 'Invitation jamais acceptée, forcée à expirer',
        subject,
        trajectory: null,
        targetUserId: null,
        matchId: match.id,
        gameName: row.gameName,
        gameIcon: row.gameIcon,
      });
    }
  }

  const sorted = entries.sort((a, b) => b.at - a.at);
  return filter ? sorted.filter((entry) => entry.type === filter) : sorted;
}

export async function countAdminLog(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(pointEvents)
    .where(eq(pointEvents.type, 'admin_adjustment'));
  const adjustments = Number(rows[0]?.count ?? 0);
  const matchRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(matches)
    .where(
      or(
        isNotNull(matches.settledBy),
        isNotNull(matches.forcedBy),
        and(isNotNull(matches.cancelledBy), isNotNull(matches.reportedAt)),
      ),
    );
  const moveRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(teamMoves);
  return (
    adjustments + Number(matchRows[0]?.count ?? 0) + Number(moveRows[0]?.count ?? 0)
  );
}
