'use server';

/**
 * Team mutations (spec 0017).
 *
 * One of them, and one only: a player chooses their own team, once. Nobody
 * moves anybody afterwards — not the player, not an admin (rule 17). The
 * decision itself lives in `src/lib/teams/membership.ts`, so it can be
 * exercised without a browser.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUserAction } from '@/lib/auth/guards';
import { buildTeamAssignedNotifications } from '@/lib/notifications/events';
import { deliver } from '@/lib/notifications/send';
import { chooseTeam } from '@/lib/teams/membership';

import { err, guarded, ok, type ActionResult } from './result';

const choiceSchema = z.object({ teamId: z.string().min(1) });

/**
 * The authenticated player joining a team, once, for themselves (rule 11).
 *
 * The cap is re-checked inside the transaction, so a forged request naming a
 * full team is refused exactly like a lost race — the screen's disabled
 * button is presentation, never authorisation.
 *
 * A choice that fills a team also places everybody still waiting (rule 13).
 * They are told afterwards, outside the transaction: delivery is network I/O
 * and must never hold a write lock, nor be able to roll back a choice
 * somebody has already made.
 */
export async function chooseMyTeam(teamId: string): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    const parsed = choiceSchema.safeParse({ teamId });
    if (!parsed.success) return err('Équipe inconnue');

    const result = chooseTeam(me.id, parsed.data.teamId);
    if (!result.ok) return err(result.message);

    if (result.assigned.length > 0) {
      await deliver(buildTeamAssignedNotifications(result.assigned)).catch((error) => {
        console.error('notifications: delivery failed', error);
      });
      for (const placed of result.assigned) {
        revalidatePath(`/players/${placed.userId}`);
      }
    }

    revalidatePath('/teams');
    revalidatePath('/leaderboard');
    revalidatePath(`/players/${me.id}`);
    return ok();
  });
}
