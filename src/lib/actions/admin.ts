'use server';

/**
 * Admin operations (spec 0008).
 *
 * Every one of them is visible to the people it affects: a resolution notifies
 * the participants, an adjustment lands in a public ledger. There is no silent
 * admin action, which is what makes an admin fix distinguishable from cheating.
 */
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { clientErrors, pointEvents, users } from '@/db/schema';
import { performTournamentReset } from '@/lib/admin/reset';
import { requireAdminAction } from '@/lib/auth/guards';
import { applyMatchAction } from '@/lib/matches/apply';

import { err, guarded, ok, type ActionResult } from './result';

const resolveSchema = z.object({
  matchId: z.string().min(1),
  outcome: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('settle'),
      winningSide: z.coerce.number().int().min(1).max(4),
      scores: z.array(
        z.object({
          sideIndex: z.coerce.number().int().min(1),
          score: z.coerce.number().int().min(0),
        }),
      ),
      // Required, and shown in the public log: an arbitration nobody can
      // explain is indistinguishable from favouritism (spec 0008, rule 3).
      note: z.string().trim().min(5, 'Explique ta décision (5 caractères minimum)').max(280),
    }),
    z.object({ kind: z.literal('cancel'), reason: z.string().trim().min(1).max(280) }),
  ]),
});

export async function resolveDispute(
  input: z.input<typeof resolveSchema>,
): Promise<ActionResult> {
  return guarded(async () => {
    const admin = await requireAdminAction();
    const parsed = resolveSchema.safeParse(input);
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? 'Décision invalide');
    }

    const result = await applyMatchAction(parsed.data.matchId, {
      type: 'resolve',
      adminId: admin.id,
      outcome: parsed.data.outcome,
    });
    if (!result.ok) {
      return err(
        result.code === 'wrong_state' ? 'Cette partie a déjà été tranchée' : result.message,
      );
    }

    revalidatePath('/admin');
    revalidatePath('/admin-log');
    revalidatePath(`/matches/${parsed.data.matchId}`);
    revalidatePath('/leaderboard');
    revalidatePath('/history');
    return ok();
  });
}

const adminCancelSchema = z.object({
  matchId: z.string().min(1),
  reason: z.string().trim().min(1, 'Explique pourquoi').max(280),
  /**
   * Cancelling a completed match changes the leaderboard, so it demands a
   * typed confirmation (spec 0008, failure table).
   */
  confirmation: z.string().optional(),
});

export async function adminCancelMatch(
  input: z.input<typeof adminCancelSchema>,
  requiresConfirmation: boolean,
): Promise<ActionResult> {
  return guarded(async () => {
    const admin = await requireAdminAction();
    const parsed = adminCancelSchema.safeParse(input);
    if (!parsed.success) return err('Explique pourquoi (1 caractère minimum)');

    if (requiresConfirmation && parsed.data.confirmation?.trim().toUpperCase() !== 'ANNULER') {
      return err('Tape ANNULER pour confirmer');
    }

    const result = await applyMatchAction(parsed.data.matchId, {
      type: 'cancel',
      userId: admin.id,
      isAdmin: true,
      reason: parsed.data.reason,
    });
    if (!result.ok) return err(result.message);

    revalidatePath('/admin');
    revalidatePath('/admin-log');
    revalidatePath(`/matches/${parsed.data.matchId}`);
    revalidatePath('/leaderboard');
    revalidatePath('/history');
    return ok();
  });
}

export async function forceExpireMatch(matchId: string): Promise<ActionResult> {
  return guarded(async () => {
    const admin = await requireAdminAction();
    // `expire` refuses a match that is still in time, which is the correct
    // behaviour: an admin should cancel it instead of faking an expiry.
    // Passing the admin id is what puts the action in the public log.
    const result = await applyMatchAction(matchId, { type: 'expire', byUserId: admin.id });
    if (!result.ok) {
      return err(
        result.code === 'not_expired_yet'
          ? 'Cette invitation n’a pas encore expiré — annule la partie à la place'
          : result.message,
      );
    }
    revalidatePath('/admin');
    revalidatePath('/admin-log');
    revalidatePath(`/matches/${matchId}`);
    return ok();
  });
}

const adjustmentSchema = z.object({
  userId: z.string().min(1),
  points: z.coerce
    .number()
    .int()
    .min(-1000, 'Maximum 1000 points')
    .max(1000, 'Maximum 1000 points')
    .refine((v) => v !== 0, 'Indique un nombre de points non nul'),
  reason: z.string().trim().min(5, 'Explique pourquoi (5 caractères minimum)').max(280),
});

export async function adjustPoints(
  input: z.input<typeof adjustmentSchema>,
): Promise<ActionResult> {
  return guarded(async () => {
    const admin = await requireAdminAction();
    const parsed = adjustmentSchema.safeParse(input);
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? 'Ajustement invalide');
    }

    const target = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, parsed.data.userId))
      .limit(1);
    if (target.length === 0) return err('Joueur inconnu');

    // A normal ledger row: signed, immutable, attributed, and public
    // (spec 0008, rule 11). The unique index does not apply, because matchId
    // is null for adjustments — an admin may legitimately adjust twice.
    await db.insert(pointEvents).values({
      id: crypto.randomUUID(),
      userId: parsed.data.userId,
      matchId: null,
      type: 'admin_adjustment',
      points: parsed.data.points,
      detail: parsed.data.reason,
      createdBy: admin.id,
      createdAt: Date.now(),
    });

    revalidatePath('/leaderboard');
    revalidatePath(`/players/${parsed.data.userId}`);
    revalidatePath('/admin');
    revalidatePath('/admin-log');
    return ok();
  });
}

const fingerprintSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{20}$/, 'empreinte invalide'),
  resolved: z.boolean(),
});

/**
 * Marks a browser-error group handled, or reopens it (spec 0011, rule 18).
 *
 * Resolving hides it from the default view and never deletes it: the count and
 * the first-seen date are the evidence that it happened. A later occurrence
 * clears `resolvedAt` by itself, in the report endpoint — a bug that comes
 * back is news.
 */
export async function setClientErrorResolved(
  input: z.input<typeof fingerprintSchema>,
): Promise<ActionResult> {
  return guarded(async () => {
    await requireAdminAction();
    const parsed = fingerprintSchema.safeParse(input);
    if (!parsed.success) return err('Empreinte invalide');

    const updated = await db
      .update(clientErrors)
      .set({ resolvedAt: parsed.data.resolved ? Date.now() : null })
      .where(eq(clientErrors.fingerprint, parsed.data.fingerprint))
      .returning({ fingerprint: clientErrors.fingerprint });

    if (updated.length === 0) return err('Cette erreur n\u2019existe plus');

    revalidatePath('/admin/errors');
    revalidatePath('/admin');
    return ok();
  });
}

const resetTournamentSchema = z.object({
  confirmation: z.string(),
});

/**
 * Resets the whole competition before official kickoff (spec 0008, rules 22-25).
 * Clears all points, matches, participants, sides, notifications, and resets
 * teams for all players except the captains.
 */
export async function resetTournament(
  input: z.input<typeof resetTournamentSchema>,
): Promise<ActionResult> {
  return guarded(async () => {
    await requireAdminAction();
    const parsed = resetTournamentSchema.safeParse(input);
    if (!parsed.success || parsed.data.confirmation.trim().toLowerCase() !== 'confirmer') {
      return err('Tape « confirmer » pour valider');
    }

    performTournamentReset(db);

    revalidatePath('/', 'layout');
    revalidatePath('/admin');
    revalidatePath('/admin-log');
    revalidatePath('/leaderboard');
    revalidatePath('/history');
    revalidatePath('/teams');
    revalidatePath('/team-choice');
    return ok();
  });
}

