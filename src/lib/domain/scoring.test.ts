import { describe, expect, it } from 'vitest';

import {
  compareStandings,
  computeAwards,
  computeMargin,
  computeMarginBonus,
  computeReversals,
  rankStandings,
  type AwardInput,
} from './scoring';
import type { ScoringRules } from './types';

const noBonus: ScoringRules = {
  pointsPerWin: 10,
  marginBonusPerPoint: 0,
  marginBonusCap: null,
  requiresScore: false,
};

const withBonus: ScoringRules = {
  pointsPerWin: 10,
  marginBonusPerPoint: 1,
  marginBonusCap: null,
  requiresScore: true,
};

function palet(overrides: Partial<AwardInput> = {}): AwardInput {
  return {
    rules: withBonus,
    gameName: 'Palet',
    winningSide: 1,
    sides: [
      { sideIndex: 1, score: 13 },
      { sideIndex: 2, score: 2 },
    ],
    participants: [
      { userId: 'alice', sideIndex: 1 },
      { userId: 'bob', sideIndex: 2 },
    ],
    ...overrides,
  };
}

describe('computeMargin', () => {
  it('is the gap to the closest runner-up', () => {
    expect(
      computeMargin(1, [
        { sideIndex: 1, score: 13 },
        { sideIndex: 2, score: 7 },
        { sideIndex: 3, score: 1 },
      ]),
    ).toBe(6);
  });

  it('is null when a score is missing', () => {
    expect(
      computeMargin(1, [
        { sideIndex: 1, score: 13 },
        { sideIndex: 2, score: null },
      ]),
    ).toBeNull();
  });

  it('is null when the winner has no score', () => {
    expect(
      computeMargin(1, [
        { sideIndex: 1, score: null },
        { sideIndex: 2, score: 3 },
      ]),
    ).toBeNull();
  });
});

describe('computeMarginBonus', () => {
  it('is the margin times the per-point rate', () => {
    expect(computeMarginBonus(palet())).toEqual({
      points: 11,
      detail: 'Écart 13–2 × 1 pt',
    });
  });

  it('is capped, and says so', () => {
    const bonus = computeMarginBonus(
      palet({ rules: { ...withBonus, marginBonusCap: 5 } }),
    );
    expect(bonus?.points).toBe(5);
    expect(bonus?.detail).toContain('plafonné à 5');
  });

  it('does not apply below the cap', () => {
    const bonus = computeMarginBonus(
      palet({
        rules: { ...withBonus, marginBonusCap: 50 },
      }),
    );
    expect(bonus?.points).toBe(11);
    expect(bonus?.detail).not.toContain('plafonné');
  });

  it('multiplies by the configured rate', () => {
    expect(
      computeMarginBonus(palet({ rules: { ...withBonus, marginBonusPerPoint: 2 } }))?.points,
    ).toBe(22);
  });

  it('is absent when the bonus is disabled', () => {
    expect(computeMarginBonus(palet({ rules: noBonus }))).toBeNull();
  });

  it('is absent when no score was recorded', () => {
    expect(
      computeMarginBonus(
        palet({
          sides: [
            { sideIndex: 1, score: null },
            { sideIndex: 2, score: null },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe('computeAwards', () => {
  it('writes one base event and one bonus event for a duel win', () => {
    const awards = computeAwards(palet());
    expect(awards).toEqual([
      { userId: 'alice', type: 'match_win', points: 10, detail: 'Victoire — Palet' },
      { userId: 'alice', type: 'margin_bonus', points: 11, detail: 'Écart 13–2 × 1 pt' },
    ]);
  });

  it('gives the losing side no rows at all', () => {
    expect(computeAwards(palet()).some((a) => a.userId === 'bob')).toBe(false);
  });

  it('gives every player of a winning team the full points', () => {
    const awards = computeAwards(
      palet({
        rules: noBonus,
        gameName: 'Pétanque',
        participants: [
          { userId: 'alice', sideIndex: 1 },
          { userId: 'anna', sideIndex: 1 },
          { userId: 'amir', sideIndex: 1 },
          { userId: 'bob', sideIndex: 2 },
        ],
      }),
    );
    expect(awards).toHaveLength(3);
    expect(awards.every((a) => a.points === 10)).toBe(true);
    expect(awards.map((a) => a.userId)).toEqual(['alice', 'anna', 'amir']);
  });

  it('writes no bonus row when the bonus is disabled', () => {
    expect(computeAwards(palet({ rules: noBonus }))).toHaveLength(1);
  });

  it('writes nothing when the winning side has no players', () => {
    expect(computeAwards(palet({ winningSide: 2, participants: [] }))).toEqual([]);
  });

  it('uses the snapshotted rules, not a game’s current ones', () => {
    // The caller passes the match snapshot; there is no code path here that
    // could reach a `games` row (spec 0005, criterion).
    const awards = computeAwards(palet({ rules: { ...withBonus, pointsPerWin: 99 } }));
    expect(awards[0]?.points).toBe(99);
  });
});

describe('computeReversals', () => {
  it('produces one negative row per player, summing to the opposite', () => {
    const awarded = [
      { userId: 'alice', points: 10 },
      { userId: 'alice', points: 11 },
      { userId: 'anna', points: 10 },
    ];
    expect(computeReversals(awarded, 'Palet')).toEqual([
      {
        userId: 'alice',
        type: 'match_reversal',
        points: -21,
        detail: 'Partie annulée par un admin — Palet',
      },
      {
        userId: 'anna',
        type: 'match_reversal',
        points: -10,
        detail: 'Partie annulée par un admin — Palet',
      },
    ]);
  });

  it('brings a total back to its previous value', () => {
    const awarded = [
      { userId: 'alice', points: 10 },
      { userId: 'alice', points: 11 },
    ];
    const total = awarded.reduce((sum, a) => sum + a.points, 0);
    const reversed = computeReversals(awarded, 'Palet').reduce((s, a) => s + a.points, 0);
    expect(total + reversed).toBe(0);
  });

  it('writes nothing for a match that awarded nothing', () => {
    expect(computeReversals([], 'Palet')).toEqual([]);
  });
});

describe('leaderboard ranking', () => {
  const player = (name: string, points: number, wins: number, played: number) => ({
    userId: name.toLowerCase(),
    name,
    points,
    wins,
    played,
  });

  it('orders by points descending', () => {
    const sorted = [player('A', 5, 1, 1), player('B', 20, 1, 1)].sort(compareStandings);
    expect(sorted[0]?.name).toBe('B');
  });

  it('breaks a points tie on wins', () => {
    const sorted = [player('A', 20, 1, 3), player('B', 20, 2, 3)].sort(compareStandings);
    expect(sorted[0]?.name).toBe('B');
  });

  it('prefers fewer matches for the same points and wins', () => {
    const sorted = [player('A', 20, 2, 9), player('B', 20, 2, 3)].sort(compareStandings);
    expect(sorted[0]?.name).toBe('B');
  });

  it('falls back to the name', () => {
    const sorted = [player('Zoe', 0, 0, 0), player('Alice', 0, 0, 0)].sort(compareStandings);
    expect(sorted[0]?.name).toBe('Alice');
  });

  it('keeps players with no points on the board', () => {
    const ranked = rankStandings([player('Alice', 10, 1, 1), player('Bob', 0, 0, 0)]);
    expect(ranked).toHaveLength(2);
    expect(ranked[1]).toMatchObject({ name: 'Bob', rank: 2, points: 0 });
  });

  it('gives tied players the same rank', () => {
    const ranked = rankStandings([
      player('Alice', 10, 1, 1),
      player('Bob', 10, 1, 1),
      player('Carol', 5, 0, 1),
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });
});
