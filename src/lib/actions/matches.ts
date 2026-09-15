'use server';

/**
 * Match mutations (spec 0004).
 *
 * Every one of these parses its input, checks authorisation server-side, and
 * then delegates the decision to the state machine via `applyMatchAction`.
 * None of them writes `matches.status` themselves (AGENTS.md §5).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { games, matchParticipants, matchSides, matches, users } from '@/db/schema';
import { requireUserAction } from '@/lib/auth/guards';
import { scoringRulesFor } from '@/lib/domain/game-rules';
import { INVITATION_TTL_MS } from '@/lib/domain/types';
import { applyMatchAction } from '@/lib/matches/apply';
import {
  buildNotifications,
  type NotificationIntent,
} from '@/lib/notifications/events';
import { deliver } from '@/lib/notifications/send';

import { err, guarded, ok, type ActionResult } from './result';

const createSchema = z.object({
  gameId: z.string().min(1),
  assignments: z
    .array(z.object({ userId: z.string().min(1), sideIndex: z.number().int().min(1) }))
    .min(1),
});

/** "Alice & Anna" reads better than "Équipe 1"; past 3 players it does not. */
function sideLabel(names: string[], sideIndex: number): string {
  if (names.length === 0) return `Camp ${sideIndex}`;
  if (names.length === 1) return names[0] as string;
  if (names.length <= 3) return names.join(' & ');
  return `Équipe ${sideIndex}`;
}

export async function createMatch(input: {
  gameId: string;
  assignments: { userId: string; sideIndex: number }[];
}): Promise<ActionResult<{ matchId: string }>> {
  return guarded(async () => {
    const me = await requireUserAction();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return err<{ matchId: string }>('Sélection invalide');
    const { gameId, assignments } = parsed.data;

    const now = Date.now();

    type CreateOutcome =
      | { ok: false; message: string }
      | { ok: true; matchId: string; intents: NotificationIntent[] };

    const outcome = db.transaction((tx): CreateOutcome => {
      const game = tx.select().from(games).where(eq(games.id, gameId)).get();
      if (!game) return { ok: false, message: 'Ce jeu n’existe pas' };
      if (!game.isActive) return { ok: false, message: 'Ce jeu est archivé' };

      // The creator is always a participant, on side 1 (spec 0004, rule 2).
      const withCreator = assignments.some((a) => a.userId === me.id)
        ? assignments
        : [...assignments, { userId: me.id, sideIndex: 1 }];

      const seen = new Set<string>();
      for (const a of withCreator) {
        if (seen.has(a.userId)) {
          return { ok: false, message: 'Un joueur ne peut pas être dans deux camps' };
        }
        seen.add(a.userId);
        if (a.sideIndex < 1 || a.sideIndex > game.sidesCount) {
          return { ok: false, message: 'Camp invalide' };
        }
      }
      if (withCreator.find((a) => a.userId === me.id)?.sideIndex !== 1) {
        return { ok: false, message: 'Le créateur joue dans le camp 1' };
      }

      for (let sideIndex = 1; sideIndex <= game.sidesCount; sideIndex += 1) {
        const count = withCreator.filter((a) => a.sideIndex === sideIndex).length;
        if (count !== game.playersPerSide) {
          return {
            ok: false,
            message: `Il manque des joueurs dans le camp ${sideIndex} (${count}/${game.playersPerSide})`,
          };
        }
      }

      // The busy check runs inside the transaction so two people cannot each
      // invite the same third player at the same moment (spec 0004, rule 8).
      const busyRows = tx
        .select({ userId: matchParticipants.userId, name: users.name })
        .from(matchParticipants)
        .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
        .innerJoin(users, eq(users.id, matchParticipants.userId))
        .where(
          and(
            inArray(
              matchParticipants.userId,
              withCreator.map((a) => a.userId),
            ),
            inArray(matches.status, ['pending', 'active', 'awaiting_validation', 'disputed']),
            sql`(${matches.status} != 'pending' OR (${matchParticipants.invitationStatus} = 'accepted' AND ${matches.invitationExpiresAt} > ${now}))`,
          ),
        )
        .all();

      const busySelf = busyRows.find((r) => r.userId === me.id);
      if (busySelf) return { ok: false, message: 'Tu as déjà une partie en cours' };
      const busyOther = busyRows[0];
      if (busyOther) return { ok: false, message: `${busyOther.name} est déjà en partie` };

      const rules = scoringRulesFor(game);
      const matchId = crypto.randomUUID();

      tx.insert(matches)
        .values({
          id: matchId,
          gameId: game.id,
          createdBy: me.id,
          status: 'pending',
          invitationExpiresAt: now + INVITATION_TTL_MS,
          rulePointsPerWin: rules.pointsPerWin,
          ruleMarginBonusPerPoint: rules.marginBonusPerPoint,
          ruleMarginBonusCap: rules.marginBonusCap,
          ruleRequiresScore: rules.requiresScore,
          winningSide: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const roster = tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          inArray(
            users.id,
            withCreator.map((a) => a.userId),
          ),
        )
        .all();
      const nameOf = new Map(roster.map((r) => [r.id, r.name]));
      if (nameOf.size !== withCreator.length) {
        return { ok: false, message: 'Joueur inconnu dans la sélection' };
      }

      for (let sideIndex = 1; sideIndex <= game.sidesCount; sideIndex += 1) {
        const names = withCreator
          .filter((a) => a.sideIndex === sideIndex)
          .map((a) => nameOf.get(a.userId) ?? '?')
          .sort((a, b) => a.localeCompare(b, 'fr'));
        tx.insert(matchSides)
          .values({
            matchId,
            sideIndex,
            label: sideLabel(names, sideIndex),
            score: null,
            validatedAt: null,
            validatedBy: null,
          })
          .run();
      }

      tx.insert(matchParticipants)
        .values(
          withCreator.map((a) => ({
            matchId,
            userId: a.userId,
            sideIndex: a.sideIndex,
            // The creator is pre-accepted (spec 0004, rule 2).
            invitationStatus: (a.userId === me.id ? 'accepted' : 'pending') as
              | 'accepted'
              | 'pending',
            respondedAt: a.userId === me.id ? now : null,
          })),
        )
        .run();

      const sides = tx.select().from(matchSides).where(eq(matchSides.matchId, matchId)).all();
      const invited = withCreator.filter((a) => a.userId !== me.id).map((a) => a.userId);

      return {
        ok: true,
        matchId,
        intents: buildNotifications(
          { kind: 'invitation_received', invitedUserIds: invited },
          {
            matchId,
            gameName: game.name,
            gameIcon: game.icon,
            actorId: me.id,
            actorName: me.name,
            participants: withCreator,
            sideLabels: Object.fromEntries(sides.map((s) => [s.sideIndex, s.label])),
            adminIds: [],
          },
        ),
      };
    });

    if (!outcome.ok) return err<{ matchId: string }>(outcome.message);

    await deliver(outcome.intents).catch((error) => {
      console.error('notifications: delivery failed', error);
    });

    revalidatePath('/leaderboard');
    revalidatePath('/games');
    revalidatePath('/history');
    return ok({ matchId: outcome.matchId });
  });
}

const matchIdSchema = z.object({ matchId: z.string().min(1) });

async function refresh(matchId: string): Promise<void> {
  revalidatePath(`/matches/${matchId}`);
  revalidatePath('/leaderboard');
  revalidatePath('/history');
  revalidatePath('/notifications');
}

export async function acceptInvitation(matchId: string): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    if (!matchIdSchema.safeParse({ matchId }).success) return err('Partie inconnue');

    // A busy player may decline but never accept (spec 0004, rule 8).
    const busy = await db
      .select({ id: matches.id })
      .from(matchParticipants)
      .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
      .where(
        and(
          eq(matchParticipants.userId, me.id),
          inArray(matches.status, ['active', 'awaiting_validation', 'disputed']),
        ),
      )
      .limit(1);
    if (busy.length > 0) return err('Termine ta partie en cours d’abord');

    const result = await applyMatchAction(matchId, { type: 'accept', userId: me.id });
    if (!result.ok) return err(result.message);
    await refresh(matchId);
    return ok();
  });
}

export async function declineInvitation(matchId: string): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    const result = await applyMatchAction(matchId, { type: 'decline', userId: me.id });
    if (!result.ok) return err(result.message);
    await refresh(matchId);
    return ok();
  });
}

const reportSchema = z.object({
  matchId: z.string().min(1),
  winningSide: z.coerce.number().int().min(1).max(4),
  scores: z.array(
    z.object({ sideIndex: z.coerce.number().int().min(1), score: z.coerce.number().int().min(0) }),
  ),
});

export async function reportResult(input: {
  matchId: string;
  winningSide: number;
  scores: { sideIndex: number; score: number }[];
}): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) return err('Résultat invalide');

    const result = await applyMatchAction(parsed.data.matchId, {
      type: 'report',
      userId: me.id,
      winningSide: parsed.data.winningSide,
      scores: parsed.data.scores,
    });
    if (!result.ok) return err(result.message);
    await refresh(parsed.data.matchId);
    return ok();
  });
}

export async function validateResult(matchId: string): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    const result = await applyMatchAction(matchId, { type: 'validate', userId: me.id });
    if (!result.ok) return err(result.message);
    await refresh(matchId);
    return ok();
  });
}

export async function disputeResult(
  matchId: string,
  reason: string,
): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    const trimmed = reason.trim().slice(0, 280);
    const result = await applyMatchAction(matchId, {
      type: 'dispute',
      userId: me.id,
      reason: trimmed.length > 0 ? trimmed : null,
    });
    if (!result.ok) return err(result.message);
    await refresh(matchId);
    return ok();
  });
}

export async function cancelMatch(
  matchId: string,
  reason: string,
): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    const trimmed = reason.trim().slice(0, 280);
    const result = await applyMatchAction(matchId, {
      type: 'cancel',
      userId: me.id,
      isAdmin: me.role === 'admin',
      reason: trimmed.length > 0 ? trimmed : null,
    });
    if (!result.ok) return err(result.message);
    await refresh(matchId);
    return ok();
  });
}
