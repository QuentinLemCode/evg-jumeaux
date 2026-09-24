/**
 * The bridge between the pure state machine and the database.
 *
 * Every mutation of a match goes through `applyMatchAction`. It loads a
 * snapshot, asks `transition()` what should happen, writes the effects in a
 * single transaction, and only then fans out notifications — network I/O must
 * never hold a write lock, and a dead push service must never roll back a
 * result somebody just entered.
 *
 * Concurrency: SQLite serialises the transaction, and the snapshot is read
 * inside it, so two players accepting the last invitation at the same moment
 * produce one transition and one no-op error rather than two activations
 * (spec 0004, failure table).
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import {
  games,
  matchParticipants,
  matchSides,
  matches,
  pointEvents,
  teamPointEvents,
  users,
} from '@/db/schema';
import {
  isInvitationExpired,
  sidesOwingValidation,
  transition,
  type MatchAction,
  type MatchEffect,
  type MatchErrorCode,
} from '@/lib/domain/match-state';
import { computeAwards, computeReversals } from '@/lib/domain/scoring';
import { computeTeamAwards, computeTeamReversals } from '@/lib/domain/teams';
import type { GameMode, MatchSnapshot, MatchStatus } from '@/lib/domain/types';
import {
  buildNotifications,
  type NotificationEvent,
  type NotificationIntent,
  type NotifyContext,
} from '@/lib/notifications/events';
import { deliver } from '@/lib/notifications/send';

export type ApplyResult =
  | { ok: true; status: MatchStatus }
  | { ok: false; code: MatchErrorCode | 'not_found'; message: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function loadSnapshot(tx: Tx, matchId: string): MatchSnapshot | null {
  const match = tx.select().from(matches).where(eq(matches.id, matchId)).get();
  if (!match) return null;

  const participants = tx
    .select()
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, matchId))
    .all();
  const sides = tx.select().from(matchSides).where(eq(matchSides.matchId, matchId)).all();

  return {
    id: match.id,
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
    sides: sides
      .map((s) => ({
        sideIndex: s.sideIndex,
        score: s.score,
        validatedAt: s.validatedAt,
      }))
      .sort((a, b) => a.sideIndex - b.sideIndex),
  };
}

/** Points awarded per player by a given match, for the "+N pts" notification. */
function pointsAwardedFor(tx: Tx, matchId: string): Record<string, number> {
  const rows = tx
    .select({ userId: pointEvents.userId, points: pointEvents.points })
    .from(pointEvents)
    .where(
      and(
        eq(pointEvents.matchId, matchId),
        inArray(pointEvents.type, ['match_win', 'margin_bonus']),
      ),
    )
    .all();
  const totals: Record<string, number> = {};
  for (const row of rows) totals[row.userId] = (totals[row.userId] ?? 0) + row.points;
  return totals;
}

function applyEffects(
  tx: Tx,
  matchId: string,
  nextStatus: MatchStatus,
  effects: MatchEffect[],
  now: number,
): void {
  const match = tx.select().from(matches).where(eq(matches.id, matchId)).get();
  if (!match) throw new Error(`match ${matchId} vanished mid-transaction`);
  const game = tx.select().from(games).where(eq(games.id, match.gameId)).get();
  if (!game) throw new Error(`game ${match.gameId} missing for match ${matchId}`);

  const patch: Partial<typeof matches.$inferInsert> = {
    status: nextStatus,
    updatedAt: now,
  };

  for (const effect of effects) {
    switch (effect.kind) {
      case 'set-invitation':
        tx.update(matchParticipants)
          .set({ invitationStatus: effect.status, respondedAt: now })
          .where(
            and(
              eq(matchParticipants.matchId, matchId),
              eq(matchParticipants.userId, effect.userId),
            ),
          )
          .run();
        break;

      case 'set-scores':
        for (const { sideIndex, score } of effect.scores) {
          tx.update(matchSides)
            .set({ score })
            .where(and(eq(matchSides.matchId, matchId), eq(matchSides.sideIndex, sideIndex)))
            .run();
        }
        break;

      case 'set-winning-side':
        patch.winningSide = effect.sideIndex;
        break;

      case 'set-reporter':
        patch.reportedBy = effect.userId;
        patch.reportedAt = now;
        break;

      case 'validate-side':
        tx.update(matchSides)
          .set({ validatedAt: now, validatedBy: effect.userId })
          .where(
            and(eq(matchSides.matchId, matchId), eq(matchSides.sideIndex, effect.sideIndex)),
          )
          .run();
        break;

      case 'settle':
        patch.settledAt = now;
        patch.settledBy = effect.byUserId;
        if (effect.note) patch.resolutionNote = effect.note;
        break;

      case 'force-expire':
        patch.forcedBy = effect.byUserId;
        break;

      case 'dispute':
        patch.disputedBy = effect.userId;
        patch.disputeReason = effect.reason;
        break;

      case 'cancel':
        patch.cancelledBy = effect.userId;
        patch.cancelReason = effect.reason;
        break;

      case 'award-points': {
        // Re-read the sides: `set-scores` above may have just changed them,
        // and the award must use the settled numbers.
        const sides = tx
          .select()
          .from(matchSides)
          .where(eq(matchSides.matchId, matchId))
          .all();
        const participants = tx
          .select()
          .from(matchParticipants)
          .where(eq(matchParticipants.matchId, matchId))
          .all();
        const winningSide = patch.winningSide ?? match.winningSide;
        if (winningSide === null || winningSide === undefined) {
          throw new Error(`cannot award points for ${matchId}: no winning side`);
        }

        // Rules come from the match snapshot, never from the game
        // (spec 0005, rules 13-14).
        const rules = {
          pointsPerWin: match.rulePointsPerWin,
          marginBonusPerPoint: match.ruleMarginBonusPerPoint,
          marginBonusCap: match.ruleMarginBonusCap,
          requiresScore: match.ruleRequiresScore,
        };
        const sideScores = sides.map((s) => ({ sideIndex: s.sideIndex, score: s.score }));

        const awards = computeAwards({
          rules,
          gameName: game.name,
          winningSide,
          sides: sideScores,
          participants: participants.map((p) => ({
            userId: p.userId,
            sideIndex: p.sideIndex,
          })),
        });

        if (awards.length > 0) {
          tx.insert(pointEvents)
            .values(
              awards.map((award) => ({
                id: crypto.randomUUID(),
                userId: award.userId,
                matchId,
                type: award.type,
                points: award.points,
                detail: award.detail,
                createdBy: null,
                createdAt: now,
              })),
            )
            // Idempotent by construction: the unique index on
            // (match, user, type) makes a double award a no-op rather than a
            // duplicated total (spec 0005, rule 7).
            .onConflictDoNothing()
            .run();
        }

        // The TEAM ledger (spec 0017, rules 19-22). Keyed off team MEMBERSHIP
        // and not off invitation status: whether somebody accepted says
        // nothing about which team their side belongs to (rule 20).
        const memberships = tx
          .select({ id: users.id, teamId: users.teamId })
          .from(users)
          .where(
            inArray(
              users.id,
              participants.map((p) => p.userId),
            ),
          )
          .all();
        const teamOf = new Map(memberships.map((row) => [row.id, row.teamId]));

        const teamAwards = computeTeamAwards({
          rules,
          gameName: game.name,
          winningSide,
          sides: sideScores,
          participants: participants.map((p) => ({
            sideIndex: p.sideIndex,
            teamId: teamOf.get(p.userId) ?? null,
          })),
        });

        if (teamAwards.length > 0) {
          tx.insert(teamPointEvents)
            .values(
              teamAwards.map((award) => ({
                id: crypto.randomUUID(),
                teamId: award.teamId,
                matchId,
                type: award.type,
                points: award.points,
                detail: award.detail,
                createdBy: null,
                createdAt: now,
              })),
            )
            // One row per (match, team, type), exactly as the player ledger
            // does it (rule 22).
            .onConflictDoNothing()
            .run();
        }
        break;
      }

      case 'reverse-points': {
        const awarded = tx
          .select({ userId: pointEvents.userId, points: pointEvents.points })
          .from(pointEvents)
          .where(
            and(
              eq(pointEvents.matchId, matchId),
              inArray(pointEvents.type, ['match_win', 'margin_bonus']),
            ),
          )
          .all();
        const reversals = computeReversals(awarded, game.name);
        if (reversals.length > 0) {
          tx.insert(pointEvents)
            .values(
              reversals.map((reversal) => ({
                id: crypto.randomUUID(),
                userId: reversal.userId,
                matchId,
                type: reversal.type,
                points: reversal.points,
                detail: reversal.detail,
                createdBy: null,
                createdAt: now,
              })),
            )
            .onConflictDoNothing()
            .run();
        }

        // The same, mirrored, for the teams the match paid (spec 0017,
        // rule 23). The award rows stay: the history shows both, and the
        // match leaves that team's "matches won" because the two cancel out.
        const teamAwarded = tx
          .select({ teamId: teamPointEvents.teamId, points: teamPointEvents.points })
          .from(teamPointEvents)
          .where(
            and(
              eq(teamPointEvents.matchId, matchId),
              inArray(teamPointEvents.type, ['match_win', 'margin_bonus']),
            ),
          )
          .all();
        const teamReversals = computeTeamReversals(teamAwarded, game.name);
        if (teamReversals.length > 0) {
          tx.insert(teamPointEvents)
            .values(
              teamReversals.map((reversal) => ({
                id: crypto.randomUUID(),
                teamId: reversal.teamId,
                matchId,
                type: reversal.type,
                points: reversal.points,
                detail: reversal.detail,
                createdBy: null,
                createdAt: now,
              })),
            )
            .onConflictDoNothing()
            .run();
        }
        break;
      }
    }
  }

  tx.update(matches).set(patch).where(eq(matches.id, matchId)).run();
}

function notifyContext(tx: Tx, matchId: string, actorId: string | null): NotifyContext {
  const match = tx.select().from(matches).where(eq(matches.id, matchId)).get();
  const game = match
    ? tx.select().from(games).where(eq(games.id, match.gameId)).get()
    : undefined;
  const participants = tx
    .select()
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, matchId))
    .all();
  const sides = tx.select().from(matchSides).where(eq(matchSides.matchId, matchId)).all();
  const admins = tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).all();
  const actor = actorId
    ? tx.select({ name: users.name }).from(users).where(eq(users.id, actorId)).get()
    : undefined;

  return {
    matchId,
    gameName: game?.name ?? 'la partie',
    gameIcon: game?.icon ?? '🎲',
    actorId,
    actorName: actor?.name ?? 'Quelqu’un',
    participants: participants.map((p) => ({ userId: p.userId, sideIndex: p.sideIndex })),
    sideLabels: Object.fromEntries(sides.map((s) => [s.sideIndex, s.label])),
    adminIds: admins.map((a) => a.id),
  };
}

/**
 * Maps a completed transition to the notification event it should produce.
 * Kept here rather than in the state machine so the machine stays pure and
 * free of any delivery concern.
 */
function eventFor(
  action: MatchAction,
  before: MatchSnapshot,
  nextStatus: MatchStatus,
  pointsByUser: Record<string, number>,
  /** The game's mode — a clash announces its own end (spec 0017, rule 7). */
  mode: GameMode,
): NotificationEvent | null {
  switch (action.type) {
    case 'accept':
      return nextStatus === 'active' ? { kind: 'match_started' } : null;
    case 'decline':
      return { kind: 'invitation_declined' };
    case 'expire':
      return { kind: 'invitation_expired' };
    case 'report':
      return {
        kind: 'result_reported',
        winningSide: action.winningSide,
        sidesOwingValidation: sidesOwingValidation({
          ...before,
          reportedBy: action.userId,
        }),
      };
    case 'validate':
      if (nextStatus !== 'completed') return null;
      // A clash's own ending, told to everybody except the person who just
      // validated it — unlike `result_validated`, which tells them too
      // (spec 0017, rule 7; spec 0006, rule 9).
      return mode === 'clash'
        ? {
            kind: 'clash_finished',
            winningSide: before.winningSide ?? 0,
            pointsByUser,
          }
        : {
            kind: 'result_validated',
            winningSide: before.winningSide ?? 0,
            pointsByUser,
          };
    case 'dispute':
      return {
        kind: 'result_disputed',
        reason: action.reason,
        reporterId: before.reportedBy,
      };
    case 'cancel':
      return { kind: 'match_cancelled', reason: action.reason };
    case 'resolve':
      // Including a clash: nobody validated it, so « Le grand match est
      // terminé » would have no one to leave out, and two banners for one
      // event is the noise spec 0006's single-topic rule exists to avoid.
      return {
        kind: 'dispute_resolved',
        outcome: nextStatus === 'completed' ? 'completed' : 'cancelled',
      };
  }
}

export async function applyMatchAction(
  matchId: string,
  action: MatchAction,
  now = Date.now(),
): Promise<ApplyResult> {
  const outcome = db.transaction((tx): {
    result: ApplyResult;
    intents: NotificationIntent[];
  } => {
    const snapshot = loadSnapshot(tx, matchId);
    if (!snapshot) {
      return {
        result: { ok: false, code: 'not_found', message: 'Cette partie n’existe plus' },
        intents: [],
      };
    }

    const intents: NotificationIntent[] = [];

    // Lazy expiry: a stale invitation is never shown as joinable, whether or
    // not the background sweep has run (spec 0004, rule 13).
    if (isInvitationExpired(snapshot, now)) {
      const expire = transition(snapshot, { type: 'expire' }, now);
      if (expire.ok) {
        applyEffects(tx, matchId, expire.nextStatus, expire.effects, now);
        intents.push(
          ...buildNotifications(
            { kind: 'invitation_expired' },
            notifyContext(tx, matchId, null),
          ),
        );
      }
      if (action.type === 'expire') {
        return { result: { ok: true, status: 'expired' }, intents };
      }
      // Run the original action against the pre-expiry snapshot so the player
      // gets "l'invitation a expiré" rather than a generic wrong-state error.
      const refused = transition(snapshot, action, now);
      return {
        result: refused.ok
          ? { ok: false, code: 'wrong_state', message: 'L’invitation a expiré' }
          : { ok: false, code: refused.code, message: refused.message },
        intents,
      };
    }

    const result = transition(snapshot, action, now);
    if (!result.ok) {
      return { result: { ok: false, code: result.code, message: result.message }, intents };
    }

    applyEffects(tx, matchId, result.nextStatus, result.effects, now);

    const pointsByUser =
      result.nextStatus === 'completed' ? pointsAwardedFor(tx, matchId) : {};
    const actorId = 'userId' in action ? action.userId : 'adminId' in action ? action.adminId : null;
    const mode =
      tx
        .select({ mode: games.mode })
        .from(games)
        .innerJoin(matches, eq(matches.gameId, games.id))
        .where(eq(matches.id, matchId))
        .get()?.mode ?? 'duel';
    const event = eventFor(action, snapshot, result.nextStatus, pointsByUser, mode);
    if (event) {
      intents.push(...buildNotifications(event, notifyContext(tx, matchId, actorId)));
    }

    return { result: { ok: true, status: result.nextStatus }, intents };
  });

  // Outside the transaction: delivery is network I/O and must not hold the
  // write lock, nor be able to roll back a recorded result (spec 0006, rule 11).
  if (outcome.intents.length > 0) {
    await deliver(outcome.intents).catch((error) => {
      console.error('notifications: delivery failed', error);
    });
  }

  return outcome.result;
}
