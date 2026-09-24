/**
 * The two teams (spec 0017).
 *
 * Pure, like `scoring.ts` and for the same reason: every rule here is one a
 * player will argue about on Saturday night, and a rule that can only be
 * exercised through a browser is a rule nobody checks.
 *
 * Two decisions live in this file and nowhere else:
 *
 *   1. **who may join which team** (rule 12) — the balance rule, re-checked
 *      inside the choice transaction, never only in the UI;
 *   2. **what a match owes a team** (rules 19-23) — awarded ONCE to the
 *      winning team, and only when the match opposes the two teams.
 *
 * The second is the whole reason this spec exists. `computeAwards` pays every
 * winner the full `pointsPerWin`, so summing members would make a 8 v 7 whole
 * team victory worth more to the bigger team and a 1 v 1 worth more, per head,
 * to the smaller. A match awards its points once, headcount appears nowhere,
 * and an uneven roster changes nothing.
 */
import { computeMarginBonus } from './scoring';
import type { ScoringRules, TeamPointEventType } from './types';

export type TeamSize = {
  teamId: string;
  name: string;
  memberCount: number;
};

/**
 * Rule 11: a player may join a team whose current size is **less than or
 * equal to** every other team's. Seeded one captain each, the two therefore
 * never differ by more than one, and nobody has to know the final roster.
 *
 * Written over a list rather than a pair on purpose — a third team would be a
 * spec change, but it would not be a silently wrong arithmetic.
 */
export function canJoinTeam(teamId: string, teams: TeamSize[]): boolean {
  const target = teams.find((team) => team.teamId === teamId);
  if (!target) return false;
  return teams
    .filter((team) => team.teamId !== teamId)
    .every((other) => target.memberCount <= other.memberCount);
}

/**
 * Why a team cannot be joined, in French, shown ON the disabled button — a
 * team that is simply missing from the screen reads as a bug (rule 14).
 */
export function joinBlockedReason(teamId: string, teams: TeamSize[]): string | null {
  if (canJoinTeam(teamId, teams)) return null;
  const target = teams.find((team) => team.teamId === teamId);
  if (!target) return 'Cette équipe n’existe pas.';
  const other = teams.find((team) => team.teamId !== teamId);
  if (!other) return 'Cette équipe est complète.';
  return `${target.name} a déjà un joueur d’avance — rejoins ${other.name}.`;
}

/** What the choice screen renders: both teams, each with its verdict. */
export type TeamChoiceOption = TeamSize & {
  joinable: boolean;
  blockedReason: string | null;
};

export function teamChoiceOptions(teams: TeamSize[]): TeamChoiceOption[] {
  return teams.map((team) => ({
    ...team,
    joinable: canJoinTeam(team.teamId, teams),
    blockedReason: joinBlockedReason(team.teamId, teams),
  }));
}

// ---------------------------------------------------------------- the ledger

export type TeamParticipant = {
  sideIndex: number;
  /** The player's team, or null when they never chose one (rule 21). */
  teamId: string | null;
};

export type TeamAwardInput = {
  rules: ScoringRules;
  gameName: string;
  winningSide: number;
  sides: { sideIndex: number; score: number | null }[];
  /**
   * EVERY participant of the match, declined invitations included: rule 20
   * keys off team membership, not off who turned up.
   */
  participants: TeamParticipant[];
};

export type TeamAward = {
  teamId: string;
  type: TeamPointEventType;
  points: number;
  /** French, shown verbatim on the team screen. */
  detail: string;
};

/**
 * The two teams a match opposes, by side — or null when it opposes none
 * (rule 20).
 *
 * "Opposes the two teams" means exactly: two sides, every participant of a
 * side belonging to one and the same team, and the two sides being different
 * teams. Anything else — a mixed side, a player with no team, two players of
 * the same team facing each other — earns nobody anything, which is also what
 * stops a team farming itself with its own internal pairs (rule 21).
 */
export function opposingTeams(
  participants: TeamParticipant[],
): Map<number, string> | null {
  const bySide = new Map<number, TeamParticipant[]>();
  for (const participant of participants) {
    const existing = bySide.get(participant.sideIndex);
    if (existing) existing.push(participant);
    else bySide.set(participant.sideIndex, [participant]);
  }
  if (bySide.size !== 2) return null;

  const teamOf = new Map<number, string>();
  for (const [sideIndex, members] of bySide) {
    const first = members[0];
    if (!first || first.teamId === null) return null;
    if (members.some((member) => member.teamId !== first.teamId)) return null;
    teamOf.set(sideIndex, first.teamId);
  }

  const teams = [...teamOf.values()];
  if (teams[0] === teams[1]) return null;
  return teamOf;
}

/**
 * The team ledger rows a settled match produces: `pointsPerWin` ONCE to the
 * winning team, plus the margin bonus once where the game has one (rule 19).
 * Not once per winner — that is the arithmetic this spec exists to avoid.
 */
export function computeTeamAwards(input: TeamAwardInput): TeamAward[] {
  const teams = opposingTeams(input.participants);
  if (!teams) return [];

  const winner = teams.get(input.winningSide);
  if (!winner) return [];

  const awards: TeamAward[] = [
    {
      teamId: winner,
      type: 'match_win',
      points: input.rules.pointsPerWin,
      detail: `Victoire — ${input.gameName}`,
    },
  ];

  const bonus = computeMarginBonus(input);
  if (bonus) {
    awards.push({
      teamId: winner,
      type: 'margin_bonus',
      points: bonus.points,
      detail: bonus.detail,
    });
  }

  return awards;
}

/**
 * The compensating rows for a cancelled match — one per team the match
 * awarded anything, worth the exact negative of it (rule 23). The award rows
 * stay, so the history shows both. `computeReversals`, mirrored.
 */
export function computeTeamReversals(
  awarded: { teamId: string; points: number }[],
  gameName: string,
): TeamAward[] {
  const byTeam = new Map<string, number>();
  for (const row of awarded) {
    byTeam.set(row.teamId, (byTeam.get(row.teamId) ?? 0) + row.points);
  }
  return [...byTeam.entries()]
    .filter(([, total]) => total !== 0)
    .map(([teamId, total]) => ({
      teamId,
      type: 'match_reversal' as const,
      points: -total,
      detail: `Partie annulée par un admin — ${gameName}`,
    }));
}

// ------------------------------------------------------------- the standings

export type RankableTeamStanding = {
  teamId: string;
  name: string;
  points: number;
  matchesWon: number;
};

/** Rule 27: points, then matches won, then name — and a tie stays a tie. */
export function compareTeamStandings(
  a: RankableTeamStanding,
  b: RankableTeamStanding,
): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.matchesWon !== b.matchesWon) return b.matchesWon - a.matchesWon;
  return a.name.localeCompare(b.name, 'fr');
}

export function rankTeamStandings<T extends RankableTeamStanding>(
  standings: T[],
): (T & { rank: number })[] {
  const sorted = [...standings].sort(compareTeamStandings);
  const ranked: (T & { rank: number })[] = [];
  let lastRank = 0;
  let lastKey = '';

  sorted.forEach((standing, index) => {
    const key = `${standing.points}|${standing.matchesWon}`;
    const rank = key === lastKey ? lastRank : index + 1;
    lastRank = rank;
    lastKey = key;
    ranked.push({ ...standing, rank });
  });

  return ranked;
}
