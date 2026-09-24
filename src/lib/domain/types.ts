/**
 * Domain types. Every other module imports them from here rather than
 * redeclaring them (AGENTS.md §5).
 */

export type Role = 'admin' | 'user';

export const MATCH_STATUSES = [
  'pending',
  'active',
  'awaiting_validation',
  'disputed',
  'completed',
  'cancelled',
  'expired',
] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Statuses from which nothing more can happen without an admin. */
export const TERMINAL_STATUSES = ['completed', 'cancelled', 'expired'] as const;

export type InvitationStatus = 'pending' | 'accepted' | 'declined';

/**
 * `duel` — each side is one player.
 * `team` — each side is several, and every side is the same size.
 * `clash` — each side is one of the weekend's two TEAMS, in full, and the two
 *   need not be the same size (spec 0017, rule 1). `playersPerSide` is stored
 *   as 1 and never read for a clash.
 */
export type GameMode = 'duel' | 'team' | 'clash';

export type PointEventType =
  | 'match_win'
  | 'margin_bonus'
  | 'admin_adjustment'
  | 'match_reversal';

/**
 * The team ledger's types (spec 0017). Deliberately a subset of the player
 * one: an `admin_adjustment` moves no team points (rule 23), and rule 28
 * counts a team's wins from these rows alone.
 */
export type TeamPointEventType = 'match_win' | 'margin_bonus' | 'match_reversal';

/** How long an invitation stays open (spec 0004, rule 6). */
export const INVITATION_TTL_MS = 5 * 60 * 1000;

/** How long a session lasts (spec 0001, rule 5). */
export const SESSION_TTL_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * The scoring rules a match was created with. Snapshotted onto the match so
 * that editing a game never rewrites history (spec 0005, rules 13-14).
 */
export type ScoringRules = {
  pointsPerWin: number;
  marginBonusPerPoint: number;
  marginBonusCap: number | null;
  requiresScore: boolean;
};

export type ParticipantSnapshot = {
  userId: string;
  sideIndex: number;
  invitationStatus: InvitationStatus;
};

export type SideSnapshot = {
  sideIndex: number;
  score: number | null;
  validatedAt: number | null;
};

/**
 * Everything the state machine needs to decide a transition. Deliberately a
 * plain value: `transition()` is pure and therefore trivially testable.
 */
export type MatchSnapshot = {
  id: string;
  mode?: GameMode;
  status: MatchStatus;
  sidesCount: number;
  invitationExpiresAt: number;
  requiresScore: boolean;
  createdBy: string;
  reportedBy: string | null;
  winningSide: number | null;
  participants: ParticipantSnapshot[];
  sides: SideSnapshot[];
};

export function isTerminal(status: MatchStatus): boolean {
  return (TERMINAL_STATUSES as readonly MatchStatus[]).includes(status);
}

/**
 * Statuses that make a player busy *by themselves* (spec 0004, rule 7). A
 * `pending` match also makes a player busy, but only once they have accepted,
 * which depends on the participant row and not on the status alone.
 */
export function isBusyStatus(status: MatchStatus): boolean {
  return status === 'active' || status === 'awaiting_validation' || status === 'disputed';
}
