/**
 * Point computation (spec 0005).
 *
 * This module is the ONLY place allowed to decide how many points a result is
 * worth. It is pure: it takes a completed match and returns the ledger rows to
 * append. Nothing here touches the database, and nothing outside here invents
 * a point value (AGENTS.md §5).
 *
 * Two rules drive the whole design:
 *
 *   1. Points are an append-only ledger, so a total is always explicable.
 *   2. The rules come from the match's snapshot, never from the game, so an
 *      admin editing "Palet" from 10 to 15 points cannot retroactively rewrite
 *      a leaderboard people already argued about.
 */
import type { PointEventType, ScoringRules } from './types';

export type AwardInput = {
  rules: ScoringRules;
  gameName: string;
  winningSide: number;
  sides: { sideIndex: number; score: number | null }[];
  participants: { userId: string; sideIndex: number }[];
};

export type Award = {
  userId: string;
  type: PointEventType;
  points: number;
  /** French, shown verbatim in the player's history (spec 0005, rule 12). */
  detail: string;
};

/**
 * The score difference between the winner and its closest runner-up, or null
 * when the margin cannot be computed because a score is missing.
 *
 * In a match with more than two sides only the closest runner-up counts:
 * beating a collapsed third side should not inflate the bonus.
 */
export function computeMargin(
  winningSide: number,
  sides: { sideIndex: number; score: number | null }[],
): number | null {
  const winner = sides.find((s) => s.sideIndex === winningSide);
  if (!winner || winner.score === null) return null;

  const others = sides.filter((s) => s.sideIndex !== winningSide);
  if (others.length === 0) return null;
  if (others.some((s) => s.score === null)) return null;

  const best = Math.max(...others.map((s) => s.score as number));
  return winner.score - best;
}

/**
 * The margin bonus and the arithmetic to display for it, or null when no bonus
 * applies. Returns the capped value and says so, because "why did I only get 5"
 * is exactly the question the detail string exists to answer.
 */
export function computeMarginBonus(
  input: Pick<AwardInput, 'rules' | 'winningSide' | 'sides'>,
): { points: number; detail: string } | null {
  const { marginBonusPerPoint, marginBonusCap } = input.rules;
  if (marginBonusPerPoint <= 0) return null;

  const margin = computeMargin(input.winningSide, input.sides);
  if (margin === null || margin <= 0) return null;

  const raw = margin * marginBonusPerPoint;
  const capped = marginBonusCap !== null ? Math.min(raw, marginBonusCap) : raw;
  if (capped <= 0) return null;

  const winnerScore = input.sides.find((s) => s.sideIndex === input.winningSide)?.score ?? 0;
  const runnerUp = Math.max(
    ...input.sides.filter((s) => s.sideIndex !== input.winningSide).map((s) => s.score ?? 0),
  );

  const base = `Écart ${winnerScore}–${runnerUp} × ${marginBonusPerPoint} pt`;
  const detail = capped < raw ? `${base} (plafonné à ${capped})` : base;
  return { points: capped, detail };
}

/**
 * The complete set of ledger rows for a completed match.
 *
 * Every player of the winning side gets the full `pointsPerWin` — a team win is
 * worth the same to each member, which is what the players expect and what
 * keeps team and duel games comparable on one leaderboard. Losing sides get no
 * rows at all: zero is the absence of a row, not a row worth zero.
 */
export function computeAwards(input: AwardInput): Award[] {
  const winners = input.participants.filter((p) => p.sideIndex === input.winningSide);
  if (winners.length === 0) return [];

  const bonus = computeMarginBonus(input);
  const awards: Award[] = [];

  for (const winner of winners) {
    awards.push({
      userId: winner.userId,
      type: 'match_win',
      points: input.rules.pointsPerWin,
      detail: `Victoire — ${input.gameName}`,
    });
    if (bonus) {
      awards.push({
        userId: winner.userId,
        type: 'margin_bonus',
        points: bonus.points,
        detail: bonus.detail,
      });
    }
  }

  return awards;
}

/**
 * The compensating rows for a completed match an admin is cancelling. One
 * negative row per player, summing to the exact opposite of what the match
 * awarded — the original rows stay, so the history shows both the award and
 * its reversal (spec 0008, rule 7).
 */
export function computeReversals(
  awarded: { userId: string; points: number }[],
  gameName: string,
): Award[] {
  const byUser = new Map<string, number>();
  for (const row of awarded) {
    byUser.set(row.userId, (byUser.get(row.userId) ?? 0) + row.points);
  }
  return [...byUser.entries()]
    .filter(([, total]) => total !== 0)
    .map(([userId, total]) => ({
      userId,
      type: 'match_reversal' as const,
      points: -total,
      detail: `Partie annulée par un admin — ${gameName}`,
    }));
}

/**
 * Leaderboard ordering (spec 0005, rule 15): points desc, wins desc, then
 * *fewer* matches first — the same score in fewer games is the better score —
 * then name, so the order is stable across renders.
 */
export type RankableStanding = {
  userId: string;
  name: string;
  points: number;
  wins: number;
  played: number;
};

export function compareStandings(a: RankableStanding, b: RankableStanding): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.wins !== b.wins) return b.wins - a.wins;
  if (a.played !== b.played) return a.played - b.played;
  return a.name.localeCompare(b.name, 'fr');
}

/**
 * Assigns rank numbers, giving tied players the same rank (spec 0005, rule 16).
 */
export function rankStandings<T extends RankableStanding>(
  standings: T[],
): (T & { rank: number })[] {
  const sorted = [...standings].sort(compareStandings);
  const ranked: (T & { rank: number })[] = [];
  let lastRank = 0;
  let lastKey = '';

  sorted.forEach((standing, index) => {
    const key = `${standing.points}|${standing.wins}|${standing.played}`;
    const rank = key === lastKey ? lastRank : index + 1;
    lastRank = rank;
    lastKey = key;
    ranked.push({ ...standing, rank });
  });

  return ranked;
}
