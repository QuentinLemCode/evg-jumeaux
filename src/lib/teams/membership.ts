/**
 * Joining a team, and being moved between them (spec 0017, rules 10-17).
 *
 * Not a Server Action file on purpose: the two writes below are the part that
 * has to be right, and a `'use server'` module cannot be driven from a test.
 * `src/lib/actions/teams.ts` is the thin authenticated wrapper over these.
 *
 * Both run in ONE transaction, and that is the whole design:
 *
 *   counting the teams and writing the choice cannot be two statements, or two
 *   players choosing while level both pass the check, both join the same team,
 *   and leave a gap of two that rule 11 can never close.
 */
import { eq } from 'drizzle-orm';

import { db, type Tx } from '@/db';
import { teamMoves, teams, users } from '@/db/schema';
import { canJoinTeam, type TeamSize } from '@/lib/domain/teams';
import { teamSizeQuery } from '@/lib/queries/teams';

export type MembershipResult = { ok: true } | { ok: false; message: string };

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
 * A player joining a team of their own accord (rules 10-13).
 *
 * Writes no `team_moves` row: only an admin's move is an intervention, and
 * only interventions belong in the public log (rule 15).
 */
export function chooseTeam(userId: string, teamId: string): MembershipResult {
  return db.transaction((tx): MembershipResult => {
    const me = tx
      .select({ id: users.id, teamId: users.teamId })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!me) return { ok: false, message: 'Joueur inconnu' };
    // Rule 14: a player cannot change team once chosen. Only an admin can.
    if (me.teamId !== null) {
      return { ok: false, message: 'Tu as déjà une équipe — seul un admin peut te déplacer' };
    }

    const sizes = teamSizes(tx);
    if (!sizes.some((team) => team.teamId === teamId)) {
      return { ok: false, message: 'Cette équipe n’existe pas' };
    }

    // Re-checked HERE, inside the transaction, and not merely in the screen
    // that hid the button: hiding a button is presentation, not
    // authorisation (spec 0017, Authorisation).
    if (!canJoinTeam(teamId, sizes)) {
      return {
        ok: false,
        message: 'Quelqu’un vient de rejoindre cette équipe. Prends l’autre.',
      };
    }

    tx.update(users).set({ teamId }).where(eq(users.id, userId)).run();
    return { ok: true };
  });
}

/**
 * An admin moving — or assigning — a player (rules 14-17).
 *
 * Exempt from the balance rule: this is the tool for fixing a split that
 * attendance, not choice, made lopsided (rule 16). It carries no points
 * either: the player keeps theirs and the old team keeps what it earned
 * (rule 17).
 */
export function movePlayerToTeam(input: {
  userId: string;
  teamId: string;
  reason: string;
  movedBy: string;
  now?: number;
}): MembershipResult {
  const now = input.now ?? Date.now();
  return db.transaction((tx): MembershipResult => {
    const target = tx
      .select({ id: users.id, teamId: users.teamId })
      .from(users)
      .where(eq(users.id, input.userId))
      .get();
    if (!target) return { ok: false, message: 'Joueur inconnu' };

    const destination = tx
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, input.teamId))
      .get();
    if (!destination) return { ok: false, message: 'Cette équipe n’existe pas' };

    // A captain is seeded onto their own team and cannot leave it, by
    // themselves or by an admin (rule 8).
    const captained = tx
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.captainId, input.userId))
      .get();
    if (captained) {
      return { ok: false, message: 'Un capitaine ne quitte pas son équipe' };
    }

    if (target.teamId === input.teamId) {
      return { ok: false, message: 'Ce joueur est déjà dans cette équipe' };
    }

    tx.insert(teamMoves)
      .values({
        id: crypto.randomUUID(),
        userId: input.userId,
        fromTeamId: target.teamId,
        toTeamId: input.teamId,
        reason: input.reason,
        movedBy: input.movedBy,
        createdAt: now,
      })
      .run();
    tx.update(users).set({ teamId: input.teamId }).where(eq(users.id, input.userId)).run();
    return { ok: true };
  });
}
