'use server';

/**
 * Team mutations (spec 0017).
 *
 * Two of them, and they are deliberately asymmetric: a player chooses once,
 * for themselves, under the balance rule; an admin moves anybody, with a
 * stated reason, exempt from it. The decisions themselves live in
 * `src/lib/teams/membership.ts` so they can be exercised without a browser.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdminAction, requireUserAction } from '@/lib/auth/guards';
import { chooseTeam, movePlayerToTeam } from '@/lib/teams/membership';

import { err, guarded, ok, type ActionResult } from './result';

const choiceSchema = z.object({ teamId: z.string().min(1) });

/**
 * The authenticated player joining a team, once, for themselves (rule 9).
 *
 * The balance rule is re-checked inside the transaction, so a forged request
 * naming the full team is refused exactly like a lost race — the screen's
 * disabled button is presentation, never authorisation.
 */
export async function chooseMyTeam(teamId: string): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    const parsed = choiceSchema.safeParse({ teamId });
    if (!parsed.success) return err('Équipe inconnue');

    const result = chooseTeam(me.id, parsed.data.teamId);
    if (!result.ok) return err(result.message);

    revalidatePath('/teams');
    revalidatePath('/leaderboard');
    revalidatePath(`/players/${me.id}`);
    return ok();
  });
}

const moveSchema = z.object({
  userId: z.string().min(1),
  teamId: z.string().min(1),
  // Five characters, like every other admin intervention: a move nobody can
  // explain is indistinguishable from favouritism (rule 13, spec 0008).
  reason: z.string().trim().min(5, 'Explique pourquoi (5 caractères minimum)').max(280),
});

export async function moveToTeam(
  input: z.input<typeof moveSchema>,
): Promise<ActionResult> {
  return guarded(async () => {
    const admin = await requireAdminAction();
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message ?? 'Déplacement invalide');
    }

    const result = movePlayerToTeam({
      userId: parsed.data.userId,
      teamId: parsed.data.teamId,
      reason: parsed.data.reason,
      movedBy: admin.id,
    });
    if (!result.ok) return err(result.message);

    revalidatePath('/teams');
    revalidatePath('/admin');
    revalidatePath('/admin-log');
    revalidatePath(`/players/${parsed.data.userId}`);
    return ok();
  });
}
