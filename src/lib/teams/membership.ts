/**
 * Joining a team (spec 0017, rules 11-17).
 *
 * Not a Server Action file on purpose: the write below is the part that has
 * to be right, and a `'use server'` module cannot be driven from a test.
 * `src/lib/actions/teams.ts` is the thin authenticated wrapper over it.
 *
 * There is exactly one write here, and there will never be a second: the
 * choice is final (rule 17). Nobody moves a player afterwards — not the
 * player, not an admin — so a team's composition cannot drift once it is set,
 * and the settlement of a clash can re-derive from membership safely.
 *
 * Everything it does happens in ONE transaction (rule 14):
 *
 *   reading the sizes, writing the choice, and placing whoever is left when
 *   that choice fills a team. Split them and two players aiming at the last
 *   slot both pass the check, and the team ends up nine.
 */
import { eq, inArray } from 'drizzle-orm';

import { db, type Tx } from '@/db';
import { users } from '@/db/schema';
import {
  canJoinTeam,
  playersSweptUpBy,
  teamCapacity,
  type TeamSize,
} from '@/lib/domain/teams';
import { teamSizeQuery } from '@/lib/queries/teams';

/** One player the app placed rather than asked (rule 13). */
export type TeamAssignment = {
  userId: string;
  teamId: string;
  teamName: string;
};

export type ChoiceResult =
  | { ok: true; assigned: TeamAssignment[] }
  | { ok: false; message: string };

/**
 * Every team with its current size, read INSIDE the caller's transaction —
 * and by the same query the choice screen displays, so the count that refuses
 * a choice and the count the player was shown cannot disagree.
 */
export function teamSizes(tx: Tx): TeamSize[] {
  return teamSizeQuery(tx)
    .all()
    .map((row) => ({
      teamId: row.teamId,
      name: row.name,
      memberCount: Number(row.memberCount),
    }));
}

/**
 * A player joining a team of their own accord (rules 11-14), and the
 * assignment that may follow it.
 *
 * Returns whom it placed, so the caller can tell them (rule 15). It does not
 * notify anybody itself: that is network I/O, and it must not hold a write
 * lock or be able to roll back a choice somebody just made.
 */
export function chooseTeam(userId: string, teamId: string): ChoiceResult {
  return db.transaction((tx): ChoiceResult => {
    // The whole roster, because the cap is derived from its size (rule 12)
    // and because whoever is left unplaced is read from the same snapshot.
    const roster = tx
      .select({ id: users.id, teamId: users.teamId })
      .from(users)
      .all();

    const me = roster.find((player) => player.id === userId);
    if (!me) return { ok: false, message: 'Joueur inconnu' };
    // Rule 17: the choice is final, for everybody, with no exception to grant.
    if (me.teamId !== null) {
      return { ok: false, message: 'Tu as déjà une équipe, et le choix est définitif' };
    }

    const sizes = teamSizes(tx);
    const chosen = sizes.find((team) => team.teamId === teamId);
    if (!chosen) return { ok: false, message: 'Cette équipe n’existe pas' };

    const capacity = teamCapacity(roster.length);

    // Re-checked HERE, inside the transaction, and not merely in the screen
    // that disabled the button: hiding a control is presentation, never
    // authorisation (spec 0017, Authorisation).
    if (!canJoinTeam(teamId, sizes, capacity)) {
      return {
        ok: false,
        message: 'Quelqu’un vient de rejoindre cette équipe. Prends l’autre.',
      };
    }

    tx.update(users).set({ teamId }).where(eq(users.id, userId)).run();

    const other = sizes.find((team) => team.teamId !== teamId);
    if (!other) return { ok: true, assigned: [] };

    const sweep = playersSweptUpBy({
      chosen,
      other,
      capacity,
      unplaced: roster
        .filter((player) => player.teamId === null && player.id !== userId)
        .map((player) => player.id),
    });
    if (!sweep) return { ok: true, assigned: [] };

    // The same transaction: this choice and these placements are one event,
    // and a crash between them would leave a full team beside players nobody
    // ever placed (rule 14).
    tx.update(users)
      .set({ teamId: sweep.teamId })
      .where(inArray(users.id, sweep.userIds))
      .run();

    return {
      ok: true,
      assigned: sweep.userIds.map((placed) => ({
        userId: placed,
        teamId: sweep.teamId,
        teamName: sweep.teamName,
      })),
    };
  });
}
