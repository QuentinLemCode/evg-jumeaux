'use server';

/**
 * Match mutations (spec 0004).
 *
 * Every one of these parses its input, checks authorisation server-side, and
 * then delegates the decision to the state machine via `applyMatchAction`.
 * None of them writes `matches.status` themselves (AGENTS.md §5).
 */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { games, matchParticipants, matchSides, matches, teams, users } from '@/db/schema';
import { requireUserAction } from '@/lib/auth/guards';
import { scoringRulesFor } from '@/lib/domain/game-rules';
import { initialStatus, startsAccepted } from '@/lib/domain/match-state';
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

/**
 * "Alice & Anna" reads better than "Camp 1"; past 3 players it does not.
 *
 * Never «Équipe»: that word now names one of the weekend's two teams, and a
 * side of a match is a **camp** (spec 0017, rule 31). The one exception is a
 * clash, whose sides really are the teams — it passes their names in.
 */
function sideLabel(names: string[], sideIndex: number): string {
  if (names.length === 0) return `Camp ${sideIndex}`;
  if (names.length === 1) return names[0] as string;
  if (names.length <= 3) return names.join(' & ');
  return `Camp ${sideIndex}`;
}

/** Shown whenever a clash's two sides are not the two teams in full. */
const CLASH_SHAPE_ERROR = 'Un match d’équipes oppose les deux équipes au complet';

type Assignment = { userId: string; sideIndex: number };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A clash's sides must be exactly the two teams, in full (spec 0017, rule 3).
 *
 * Membership at creation is what is checked, and it is the whole check: from
 * the moment it exists the clash is `active` with everybody in it, so there
 * is no later point at which its shape could change.
 *
 * Returns the two teams by side, or the message to refuse with.
 */
function resolveClashSides(
  tx: Tx,
  assignments: Assignment[],
  creatorId: string,
): { ok: true; teamNames: Map<number, string> } | { ok: false; message: string } {
  // Nobody may be left out of the set piece: its sides are the two teams in
  // full, and a player nobody has placed belongs to neither. The refusal
  // counts them, because "not yet" is useless without "waiting on three
  // people" (spec 0017, rule 6).
  const unplaced = tx
    .select({ id: users.id })
    .from(users)
    .where(isNull(users.teamId))
    .all();
  if (unplaced.length > 0) {
    return {
      ok: false,
      message:
        unplaced.length === 1
          ? '1 joueur n’a pas encore d’équipe'
          : `${unplaced.length} joueurs n’ont pas encore d’équipe`,
    };
  }

  if (!assignments.some((a) => a.userId === creatorId)) {
    return { ok: false, message: 'Tu ne fais partie d’aucune des deux équipes' };
  }

  const bySide = new Map<number, string[]>();
  for (const assignment of assignments) {
    const existing = bySide.get(assignment.sideIndex);
    if (existing) existing.push(assignment.userId);
    else bySide.set(assignment.sideIndex, [assignment.userId]);
  }
  if (bySide.size !== 2) return { ok: false, message: CLASH_SHAPE_ERROR };

  const roster = tx
    .select({ id: users.id, teamId: users.teamId })
    .from(users)
    .all();
  const teamOf = new Map(roster.map((row) => [row.id, row.teamId]));

  const membership = new Map<string, Set<string>>();
  for (const row of roster) {
    if (row.teamId === null) continue;
    const existing = membership.get(row.teamId);
    if (existing) existing.add(row.id);
    else membership.set(row.teamId, new Set([row.id]));
  }

  const teamBySide = new Map<number, string>();
  for (const [sideIndex, userIds] of bySide) {
    const first = userIds[0];
    const teamId = first === undefined ? null : (teamOf.get(first) ?? null);
    if (teamId === null) return { ok: false, message: CLASH_SHAPE_ERROR };
    if (userIds.some((userId) => teamOf.get(userId) !== teamId)) {
      return { ok: false, message: CLASH_SHAPE_ERROR };
    }
    const full = membership.get(teamId) ?? new Set<string>();
    if (full.size !== userIds.length) return { ok: false, message: CLASH_SHAPE_ERROR };
    teamBySide.set(sideIndex, teamId);
  }

  const chosen = [...teamBySide.values()];
  if (chosen[0] === chosen[1]) return { ok: false, message: CLASH_SHAPE_ERROR };

  const named = tx.select({ id: teams.id, name: teams.name }).from(teams).all();
  const nameOfTeam = new Map(named.map((row) => [row.id, row.name]));
  const teamNames = new Map<number, string>();
  for (const [sideIndex, teamId] of teamBySide) {
    teamNames.set(sideIndex, nameOfTeam.get(teamId) ?? `Camp ${sideIndex}`);
  }
  return { ok: true, teamNames };
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

      // A clash commits every guest at once, so an admin calls it
      // (spec 0017, Authorisation).
      const isClash = game.mode === 'clash';
      if (isClash && me.role !== 'admin') {
        return { ok: false, message: 'Réservé aux admins' };
      }

      // The creator is always a participant, on side 1 (spec 0004, rule 2).
      // A clash is the exception, and 0004 rule 2 now says so: its sides ARE
      // the two teams, so the creator sits on their own team's side and
      // adding them to side 1 would break the membership rule 3 checks.
      const withCreator =
        isClash || assignments.some((a) => a.userId === me.id)
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
      // Side labels: the players' names, or the team names for a clash
      // (spec 0017, rule 31).
      let clashTeamNames: Map<number, string> | null = null;

      if (isClash) {
        const shape = resolveClashSides(tx, withCreator, me.id);
        if (!shape.ok) return { ok: false, message: shape.message };
        clashTeamNames = shape.teamNames;
      } else {
        if (withCreator.find((a) => a.userId === me.id)?.sideIndex !== 1) {
          return { ok: false, message: 'Le créateur joue dans le camp 1' };
        }

        // The ONE check a clash had to be exempted from: its two sides are as
        // big as the teams are, and they need not match (spec 0017, rule 2).
        for (let sideIndex = 1; sideIndex <= game.sidesCount; sideIndex += 1) {
          const count = withCreator.filter((a) => a.sideIndex === sideIndex).length;
          if (count !== game.playersPerSide) {
            return {
              ok: false,
              message: `Il manque des joueurs dans le camp ${sideIndex} (${count}/${game.playersPerSide})`,
            };
          }
        }
      }

      if (isClash) {
        // A clash is outside the busy rule in both directions: a darts match
        // under way does not block it, and nobody in it becomes unavailable
        // (spec 0017, rule 6). Requiring fifteen idle guests meant the set
        // piece could never start.
        //
        // What IS refused is a SECOND clash while one is unfinished. Both
        // would claim the same two teams in full, and a team cannot play
        // itself in two places. `disputed` counts: a clash has no deadline
        // and no sweeper, so a disputed one can sit for hours waiting on an
        // admin — which is exactly where a second would slip through.
        const live = tx
          .select({ id: matches.id })
          .from(matches)
          .innerJoin(games, eq(games.id, matches.gameId))
          .where(
            and(
              eq(games.mode, 'clash'),
              inArray(matches.status, ['active', 'awaiting_validation', 'disputed']),
            ),
          )
          .limit(1)
          .all();
        if (live.length > 0) {
          return { ok: false, message: 'Un match d’équipes est déjà en cours' };
        }
      } else {
        // The busy check runs inside the transaction so two people cannot each
        // invite the same third player at the same moment (spec 0004, rule 8).
        // Clash rows are excluded for the same reason as above: being in the
        // set piece is not being busy.
        const busyRows = tx
          .select({ userId: matchParticipants.userId, name: users.name })
          .from(matchParticipants)
          .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
          .innerJoin(games, eq(games.id, matches.gameId))
          .innerJoin(users, eq(users.id, matchParticipants.userId))
          .where(
            and(
              ne(games.mode, 'clash'),
              inArray(
                matchParticipants.userId,
                withCreator.map((a) => a.userId),
              ),
              inArray(matches.status, [
                'pending',
                'active',
                'awaiting_validation',
                'disputed',
              ]),
              sql`(${matches.status} != 'pending' OR (${matchParticipants.invitationStatus} = 'accepted' AND ${matches.invitationExpiresAt} > ${now}))`,
            ),
          )
          .all();

        const busySelf = busyRows.find((r) => r.userId === me.id);
        if (busySelf) return { ok: false, message: 'Tu as déjà une partie en cours' };
        const busyOther = busyRows[0];
        if (busyOther) return { ok: false, message: `${busyOther.name} est déjà en partie` };
      }

      const rules = scoringRulesFor(game);
      const matchId = crypto.randomUUID();

      tx.insert(matches)
        .values({
          id: matchId,
          gameId: game.id,
          createdBy: me.id,
          // A clash starts `active`: it has no invitation phase at all
          // (spec 0017, rule 4; spec 0004, rule 5).
          status: initialStatus(game.mode),
          // Stored because the column requires it. Nothing reads it for a
          // clash — there is no invitation to expire (spec 0004, rule 6).
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
            label: clashTeamNames?.get(sideIndex) ?? sideLabel(names, sideIndex),
            score: null,
            validatedAt: null,
            validatedBy: null,
          })
          .run();
      }

      tx.insert(matchParticipants)
        .values(
          withCreator.map((a) => {
            // The creator is pre-accepted (spec 0004, rule 2) — and in a
            // clash so is everybody else (spec 0017, rule 4).
            const accepted = startsAccepted(game.mode, a.userId, me.id);
            return {
              matchId,
              userId: a.userId,
              sideIndex: a.sideIndex,
              invitationStatus: (accepted ? 'accepted' : 'pending') as
                | 'accepted'
                | 'pending',
              respondedAt: accepted ? now : null,
            };
          }),
        )
        .run();

      const sides = tx.select().from(matchSides).where(eq(matchSides.matchId, matchId)).all();
      const invited = withCreator.filter((a) => a.userId !== me.id).map((a) => a.userId);

      return {
        ok: true,
        matchId,
        // A clash has no invitation, so `invitation_received` is the wrong
        // event and « tout le monde a accepté » is the wrong words. It gets
        // its own: every participant except the admin who called it
        // (spec 0017, rule 7).
        intents: isClash
          ? buildNotifications(
              { kind: 'clash_started' },
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
            )
          : buildNotifications(
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
    //
    // Its own query, and therefore its own carve-out: a clash makes nobody
    // busy (spec 0017, rule 6). Without the join to `games` a player in the
    // set piece is refused every invitation of the evening with the message
    // below, which is the precise behaviour that rule forbids.
    const busy = await db
      .select({ id: matches.id })
      .from(matchParticipants)
      .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
      .innerJoin(games, eq(games.id, matches.gameId))
      .where(
        and(
          ne(games.mode, 'clash'),
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
