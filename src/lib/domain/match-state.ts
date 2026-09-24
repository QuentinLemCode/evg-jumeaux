/**
 * The match state machine (spec 0004).
 *
 * This module is the ONLY place allowed to decide a match's next status. Every
 * route, action and admin operation goes through `transition()`; nothing else
 * writes `matches.status` (AGENTS.md §5). Keeping the decision in one pure
 * function is what makes the lifecycle testable without a database, and what
 * stops a "quick fix" in a UI handler from inventing an eighth state.
 */
import {
  type GameMode,
  type MatchSnapshot,
  type MatchStatus,
  type ParticipantSnapshot,
  isTerminal,
} from './types';

export type SideScore = { sideIndex: number; score: number };

export type MatchAction =
  | { type: 'accept'; userId: string }
  | { type: 'decline'; userId: string }
  | { type: 'expire'; byUserId?: string | null }
  | { type: 'report'; userId: string; winningSide: number; scores: SideScore[] }
  | { type: 'validate'; userId: string }
  | { type: 'dispute'; userId: string; reason: string | null }
  | { type: 'cancel'; userId: string; isAdmin: boolean; reason: string | null }
  | {
      type: 'resolve';
      adminId: string;
      outcome:
        | { kind: 'settle'; winningSide: number; scores: SideScore[]; note: string }
        | { kind: 'cancel'; reason: string };
    };

/** Data the caller must persist. Notifications are derived separately. */
export type MatchEffect =
  | { kind: 'set-invitation'; userId: string; status: 'accepted' | 'declined' }
  | { kind: 'set-scores'; scores: SideScore[] }
  | { kind: 'set-winning-side'; sideIndex: number }
  | { kind: 'set-reporter'; userId: string }
  | { kind: 'validate-side'; sideIndex: number; userId: string }
  | { kind: 'award-points' }
  | { kind: 'reverse-points' }
  | { kind: 'cancel'; userId: string | null; reason: string | null }
  | { kind: 'dispute'; userId: string; reason: string | null }
  | { kind: 'settle'; byUserId: string | null; note?: string | null }
  | { kind: 'force-expire'; byUserId: string };

export type MatchErrorCode =
  | 'not_a_participant'
  | 'wrong_state'
  | 'invitation_expired'
  | 'invitation_already_answered'
  | 'already_reported'
  | 'invalid_winning_side'
  | 'missing_scores'
  | 'inconsistent_scores'
  | 'own_side_cannot_validate'
  | 'side_already_validated'
  | 'admin_only'
  | 'not_expired_yet';

export type TransitionResult =
  | { ok: true; nextStatus: MatchStatus; effects: MatchEffect[] }
  | { ok: false; code: MatchErrorCode; message: string };

/** French, because it is shown to the player as-is (spec 0004 failure table). */
const MESSAGES: Record<MatchErrorCode, string> = {
  not_a_participant: 'Tu ne participes pas à cette partie',
  wrong_state: 'Cette action n’est plus possible sur cette partie',
  invitation_expired: 'L’invitation a expiré',
  invitation_already_answered: 'Tu as déjà répondu à cette invitation',
  already_reported: 'Le résultat vient d’être saisi',
  invalid_winning_side: 'Ce camp n’existe pas dans cette partie',
  missing_scores: 'Renseigne le score de chaque camp',
  inconsistent_scores: 'Le score du gagnant doit être le plus élevé',
  own_side_cannot_validate: 'L’autre camp doit valider le résultat',
  side_already_validated: 'Ton camp a déjà validé',
  admin_only: 'Réservé aux admins',
  not_expired_yet: 'L’invitation n’a pas encore expiré',
};

function fail(code: MatchErrorCode): TransitionResult {
  return { ok: false, code, message: MESSAGES[code] };
}

function participantOf(
  match: MatchSnapshot,
  userId: string,
): ParticipantSnapshot | undefined {
  return match.participants.find((p) => p.userId === userId);
}

/**
 * How a match STARTS (spec 0004, rules 5-6).
 *
 * Here rather than in the action, because this module is the only place
 * allowed to decide a match's status and the first one is still a status.
 *
 * A `clash` has no invitation phase at all (spec 0017, rules 4-5): an admin
 * calls it, everybody is in, and it is `active` from the first millisecond.
 * Nothing about it can be declined or expire, which is why neither transition
 * below carries a special case for it.
 */
export function initialStatus(mode: GameMode): MatchStatus {
  return mode === 'clash' ? 'active' : 'pending';
}

/**
 * Whether a participant starts already accepted. The creator always does
 * (spec 0004, rule 2); in a `clash`, so does everybody else.
 */
export function startsAccepted(
  mode: GameMode,
  userId: string,
  creatorId: string,
): boolean {
  return mode === 'clash' || userId === creatorId;
}

/**
 * True when a `pending` match is past its deadline. Callers apply the `expire`
 * transition before anything else, so a stale invitation is never shown as
 * joinable even if the background sweep has not run (spec 0004, rule 13).
 */
export function isInvitationExpired(match: MatchSnapshot, now: number): boolean {
  return match.status === 'pending' && now >= match.invitationExpiresAt;
}

function validateScores(
  match: MatchSnapshot,
  winningSide: number,
  scores: SideScore[],
): TransitionResult | null {
  if (!Number.isInteger(winningSide) || winningSide < 1 || winningSide > match.sidesCount) {
    return fail('invalid_winning_side');
  }
  if (!match.requiresScore) return null;

  if (scores.length !== match.sidesCount) return fail('missing_scores');
  const bySide = new Map<number, number>();
  for (const { sideIndex, score } of scores) {
    if (sideIndex < 1 || sideIndex > match.sidesCount) return fail('invalid_winning_side');
    if (!Number.isInteger(score) || score < 0) return fail('inconsistent_scores');
    if (bySide.has(sideIndex)) return fail('inconsistent_scores');
    bySide.set(sideIndex, score);
  }
  if (bySide.size !== match.sidesCount) return fail('missing_scores');

  const winnerScore = bySide.get(winningSide);
  if (winnerScore === undefined) return fail('missing_scores');
  for (const [sideIndex, score] of bySide) {
    // Strictly greater: a match has exactly one winner, and draws are
    // cancellations (spec 0003, out of scope).
    if (sideIndex !== winningSide && score >= winnerScore) {
      return fail('inconsistent_scores');
    }
  }
  return null;
}

/** The sides that owe a validation: every side except the reporter's. */
export function sidesOwingValidation(match: MatchSnapshot): number[] {
  if (match.reportedBy === null) return [];
  const reporter = participantOf(match, match.reportedBy);
  if (!reporter) return [];
  return match.sides
    .filter((s) => s.sideIndex !== reporter.sideIndex)
    .map((s) => s.sideIndex);
}

export function transition(
  match: MatchSnapshot,
  action: MatchAction,
  now: number,
): TransitionResult {
  switch (action.type) {
    // ---------------------------------------------------------------- expire
    case 'expire': {
      if (match.status !== 'pending') return fail('wrong_state');
      if (now < match.invitationExpiresAt) return fail('not_expired_yet');
      // The sweep expires anonymously; an admin doing it by hand is recorded,
      // because killing someone's invitation is an intervention.
      const effects: MatchEffect[] = action.byUserId
        ? [{ kind: 'force-expire', byUserId: action.byUserId }]
        : [];
      return { ok: true, nextStatus: 'expired', effects };
    }

    // ---------------------------------------------------------------- accept
    case 'accept': {
      if (match.status !== 'pending') return fail('wrong_state');
      if (isInvitationExpired(match, now)) return fail('invitation_expired');
      const me = participantOf(match, action.userId);
      if (!me) return fail('not_a_participant');
      if (me.invitationStatus !== 'pending') return fail('invitation_already_answered');

      const effects: MatchEffect[] = [
        { kind: 'set-invitation', userId: action.userId, status: 'accepted' },
      ];
      const stillPending = match.participants.filter(
        (p) => p.userId !== action.userId && p.invitationStatus === 'pending',
      );
      return {
        ok: true,
        nextStatus: stillPending.length === 0 ? 'active' : 'pending',
        effects,
      };
    }

    // --------------------------------------------------------------- decline
    case 'decline': {
      if (match.status !== 'pending') return fail('wrong_state');
      const me = participantOf(match, action.userId);
      if (!me) return fail('not_a_participant');
      if (me.invitationStatus !== 'pending') return fail('invitation_already_answered');
      // One refusal cancels the match: there is no partial re-forming
      // (spec 0004, rule 12). A clash never reaches here — it has no
      // invitation to decline (spec 0017, rule 5).
      return {
        ok: true,
        nextStatus: 'cancelled',
        effects: [
          { kind: 'set-invitation', userId: action.userId, status: 'declined' },
          { kind: 'cancel', userId: action.userId, reason: 'Invitation refusée' },
        ],
      };
    }

    // ---------------------------------------------------------------- report
    case 'report': {
      if (match.status === 'awaiting_validation') return fail('already_reported');
      if (match.status !== 'active') return fail('wrong_state');
      if (!participantOf(match, action.userId)) return fail('not_a_participant');

      const invalid = validateScores(match, action.winningSide, action.scores);
      if (invalid) return invalid;

      const effects: MatchEffect[] = [
        { kind: 'set-winning-side', sideIndex: action.winningSide },
        { kind: 'set-reporter', userId: action.userId },
      ];
      if (match.requiresScore) effects.push({ kind: 'set-scores', scores: action.scores });
      return { ok: true, nextStatus: 'awaiting_validation', effects };
    }

    // -------------------------------------------------------------- validate
    case 'validate': {
      if (match.status !== 'awaiting_validation') return fail('wrong_state');
      const me = participantOf(match, action.userId);
      if (!me) return fail('not_a_participant');

      const owed = sidesOwingValidation(match);
      if (!owed.includes(me.sideIndex)) return fail('own_side_cannot_validate');

      const mySide = match.sides.find((s) => s.sideIndex === me.sideIndex);
      if (mySide?.validatedAt) return fail('side_already_validated');

      const effects: MatchEffect[] = [
        { kind: 'validate-side', sideIndex: me.sideIndex, userId: action.userId },
      ];
      const remaining = owed.filter((sideIndex) => {
        if (sideIndex === me.sideIndex) return false;
        const side = match.sides.find((s) => s.sideIndex === sideIndex);
        return side?.validatedAt === null || side?.validatedAt === undefined;
      });
      if (remaining.length > 0) {
        return { ok: true, nextStatus: 'awaiting_validation', effects };
      }
      effects.push({ kind: 'settle', byUserId: action.userId }, { kind: 'award-points' });
      return { ok: true, nextStatus: 'completed', effects };
    }

    // --------------------------------------------------------------- dispute
    case 'dispute': {
      if (match.status !== 'awaiting_validation') return fail('wrong_state');
      const me = participantOf(match, action.userId);
      if (!me) return fail('not_a_participant');
      if (!sidesOwingValidation(match).includes(me.sideIndex)) {
        return fail('own_side_cannot_validate');
      }
      return {
        ok: true,
        nextStatus: 'disputed',
        effects: [{ kind: 'dispute', userId: action.userId, reason: action.reason }],
      };
    }

    // ---------------------------------------------------------------- cancel
    case 'cancel': {
      if (match.status === 'pending' || match.status === 'active') {
        const isParticipant = participantOf(match, action.userId) !== undefined;
        if (!isParticipant && !action.isAdmin) return fail('not_a_participant');
        return {
          ok: true,
          nextStatus: 'cancelled',
          effects: [{ kind: 'cancel', userId: action.userId, reason: action.reason }],
        };
      }
      // From awaiting_validation onwards only an admin may cancel, otherwise a
      // losing player could cancel instead of validating (spec 0004, rule 24).
      if (match.status === 'awaiting_validation' || match.status === 'disputed') {
        if (!action.isAdmin) return fail('admin_only');
        return {
          ok: true,
          nextStatus: 'cancelled',
          effects: [{ kind: 'cancel', userId: action.userId, reason: action.reason }],
        };
      }
      if (match.status === 'completed') {
        if (!action.isAdmin) return fail('admin_only');
        // Points already awarded are reversed with compensating ledger rows,
        // never deleted (spec 0005, rule 3).
        return {
          ok: true,
          nextStatus: 'cancelled',
          effects: [
            { kind: 'reverse-points' },
            { kind: 'cancel', userId: action.userId, reason: action.reason },
          ],
        };
      }
      return fail('wrong_state');
    }

    // --------------------------------------------------------------- resolve
    case 'resolve': {
      if (match.status !== 'disputed') return fail('wrong_state');
      if (action.outcome.kind === 'cancel') {
        return {
          ok: true,
          nextStatus: 'cancelled',
          effects: [
            { kind: 'cancel', userId: action.adminId, reason: action.outcome.reason },
          ],
        };
      }
      const invalid = validateScores(match, action.outcome.winningSide, action.outcome.scores);
      if (invalid) return invalid;
      const effects: MatchEffect[] = [
        { kind: 'set-winning-side', sideIndex: action.outcome.winningSide },
        { kind: 'settle', byUserId: action.adminId, note: action.outcome.note },
        { kind: 'award-points' },
      ];
      if (match.requiresScore) {
        effects.splice(1, 0, { kind: 'set-scores', scores: action.outcome.scores });
      }
      return { ok: true, nextStatus: 'completed', effects };
    }
  }
}

/** Guard used by the UI to decide which buttons to show. Never authorisation. */
export function canAct(match: MatchSnapshot, userId: string, now: number): {
  canAccept: boolean;
  canDecline: boolean;
  canReport: boolean;
  canValidate: boolean;
  canCancel: boolean;
} {
  const me = participantOf(match, userId);
  const expired = isInvitationExpired(match, now);
  const owed = sidesOwingValidation(match);
  const mySide = me ? match.sides.find((s) => s.sideIndex === me.sideIndex) : undefined;
  return {
    canAccept:
      match.status === 'pending' && !expired && me?.invitationStatus === 'pending',
    canDecline:
      match.status === 'pending' && !expired && me?.invitationStatus === 'pending',
    canReport: match.status === 'active' && me !== undefined,
    canValidate:
      match.status === 'awaiting_validation' &&
      me !== undefined &&
      owed.includes(me.sideIndex) &&
      !mySide?.validatedAt,
    canCancel:
      !isTerminal(match.status) &&
      (match.status === 'pending' || match.status === 'active') &&
      me !== undefined,
  };
}
