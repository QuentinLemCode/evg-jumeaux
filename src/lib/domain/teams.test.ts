import { describe, expect, it } from 'vitest';

import {
  canJoinTeam,
  compareTeamStandings,
  computeTeamAwards,
  computeTeamReversals,
  joinBlockedReason,
  opposingTeams,
  playersSweptUpBy,
  rankTeamStandings,
  teamCapacity,
  teamChoiceOptions,
  type TeamAwardInput,
  type TeamSize,
} from './teams';
import type { ScoringRules } from './types';

const JULIEN = 'team-julien';
const PIERRE = 'team-pierre';

function sizes(julien: number, pierre: number): TeamSize[] {
  return [
    { teamId: JULIEN, name: 'Équipe Julien', memberCount: julien },
    { teamId: PIERRE, name: 'Équipe Pierre', memberCount: pierre },
  ];
}

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

/** A 1 v 1 between the two teams, which is the shape most matches have. */
function duel(overrides: Partial<TeamAwardInput> = {}): TeamAwardInput {
  return {
    rules: noBonus,
    gameName: 'Palet',
    winningSide: 1,
    sides: [
      { sideIndex: 1, score: 13 },
      { sideIndex: 2, score: 2 },
    ],
    participants: [
      { sideIndex: 1, teamId: JULIEN },
      { sideIndex: 2, teamId: PIERRE },
    ],
    ...overrides,
  };
}

describe('teamCapacity (rule 12)', () => {
  it('is half the roster, rounded up', () => {
    expect(teamCapacity(15)).toBe(8);
    expect(teamCapacity(16)).toBe(8);
    expect(teamCapacity(9)).toBe(5);
  });

  /**
   * Why rounded up rather than down: the pair has to be exhaustive. When one
   * team fills, the other must hold exactly everybody left over — one seat
   * too few and rule 13 would have nowhere to put somebody.
   */
  it('leaves the other team room for exactly everybody else', () => {
    for (const total of [2, 9, 14, 15, 16, 31]) {
      expect(teamCapacity(total) + Math.floor(total / 2)).toBe(total);
    }
  });
});

describe('canJoinTeam — the cap (rule 12)', () => {
  const CAP = 8;

  it('lets a player join either team while both have room', () => {
    // Explicitly including the team that is ahead: below the cap the choice
    // is the player's, not the arithmetic's.
    expect(canJoinTeam(JULIEN, sizes(7, 2), CAP)).toBe(true);
    expect(canJoinTeam(PIERRE, sizes(7, 2), CAP)).toBe(true);
  });

  it('refuses a full team', () => {
    expect(canJoinTeam(JULIEN, sizes(8, 2), CAP)).toBe(false);
    expect(canJoinTeam(PIERRE, sizes(8, 2), CAP)).toBe(true);
  });

  /**
   * The shape of the concurrency case (rule 14). Two players aiming at the
   * last slot both see it open; the first one through the transaction makes
   * the count 8, and the second is then refused BY THIS FUNCTION — which is
   * why reading and writing have to happen inside one transaction.
   */
  it('refuses the second of two players taking the last slot', () => {
    expect(canJoinTeam(JULIEN, sizes(7, 3), CAP)).toBe(true);
    expect(canJoinTeam(JULIEN, sizes(8, 3), CAP)).toBe(false);
  });

  it('refuses a team that does not exist', () => {
    expect(canJoinTeam('team-ghost', sizes(1, 1), CAP)).toBe(false);
  });
});

describe('joinBlockedReason (rule 16)', () => {
  it('says nothing when the team can be joined', () => {
    expect(joinBlockedReason(JULIEN, sizes(7, 1), 8)).toBeNull();
  });

  it('names the full team and the one to join instead', () => {
    expect(joinBlockedReason(JULIEN, sizes(8, 1), 8)).toBe(
      'Équipe Julien est complète — rejoins Équipe Pierre.',
    );
  });
});

describe('teamChoiceOptions', () => {
  it('always returns both teams, the full one disabled with its reason', () => {
    const options = teamChoiceOptions(sizes(8, 1), 8);
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.joinable)).toEqual([false, true]);
    expect(options[0]?.blockedReason).toContain('est complète');
    expect(options[1]?.blockedReason).toBeNull();
  });
});

describe('playersSweptUpBy (rule 13)', () => {
  const unplaced = ['dave', 'erin', 'frank'];

  it('places everybody left the moment a choice fills a team', () => {
    const sweep = playersSweptUpBy({
      chosen: { teamId: JULIEN, name: 'Équipe Julien', memberCount: 7 },
      other: { teamId: PIERRE, name: 'Équipe Pierre', memberCount: 4 },
      capacity: 8,
      unplaced,
    });
    expect(sweep).toEqual({
      teamId: PIERRE,
      teamName: 'Équipe Pierre',
      userIds: unplaced,
    });
  });

  it('places nobody while the team still has room', () => {
    expect(
      playersSweptUpBy({
        chosen: { teamId: JULIEN, name: 'Équipe Julien', memberCount: 6 },
        other: { teamId: PIERRE, name: 'Équipe Pierre', memberCount: 4 },
        capacity: 8,
        unplaced,
      }),
    ).toBeNull();
  });

  it('places nobody when the filling choice was the last one owed', () => {
    expect(
      playersSweptUpBy({
        chosen: { teamId: JULIEN, name: 'Équipe Julien', memberCount: 7 },
        other: { teamId: PIERRE, name: 'Équipe Pierre', memberCount: 7 },
        capacity: 8,
        unplaced: [],
      }),
    ).toBeNull();
  });
});

describe('opposingTeams (rule 20)', () => {
  it('maps each side to its team when the match opposes the two', () => {
    const teams = opposingTeams([
      { sideIndex: 1, teamId: JULIEN },
      { sideIndex: 2, teamId: PIERRE },
    ]);
    expect(teams?.get(1)).toBe(JULIEN);
    expect(teams?.get(2)).toBe(PIERRE);
  });

  it('is null when both sides are the same team', () => {
    expect(
      opposingTeams([
        { sideIndex: 1, teamId: JULIEN },
        { sideIndex: 2, teamId: JULIEN },
      ]),
    ).toBeNull();
  });

  it('is null when a side is mixed', () => {
    expect(
      opposingTeams([
        { sideIndex: 1, teamId: JULIEN },
        { sideIndex: 1, teamId: PIERRE },
        { sideIndex: 2, teamId: PIERRE },
      ]),
    ).toBeNull();
  });

  it('is null when a participant has no team', () => {
    expect(
      opposingTeams([
        { sideIndex: 1, teamId: null },
        { sideIndex: 2, teamId: PIERRE },
      ]),
    ).toBeNull();
  });

  it('is null when there are not exactly two sides', () => {
    expect(
      opposingTeams([
        { sideIndex: 1, teamId: JULIEN },
        { sideIndex: 2, teamId: PIERRE },
        { sideIndex: 3, teamId: PIERRE },
      ]),
    ).toBeNull();
  });
});

describe('computeTeamAwards (rules 19-21)', () => {
  it('pays the winning team once in a 1 v 1', () => {
    expect(computeTeamAwards(duel())).toEqual([
      { teamId: JULIEN, type: 'match_win', points: 10, detail: 'Victoire — Palet' },
    ]);
  });

  it('pays the same once in a 3 v 3', () => {
    const awards = computeTeamAwards(
      duel({
        participants: [
          { sideIndex: 1, teamId: JULIEN },
          { sideIndex: 1, teamId: JULIEN },
          { sideIndex: 1, teamId: JULIEN },
          { sideIndex: 2, teamId: PIERRE },
          { sideIndex: 2, teamId: PIERRE },
          { sideIndex: 2, teamId: PIERRE },
        ],
      }),
    );
    expect(awards).toHaveLength(1);
    expect(awards[0]?.points).toBe(10);
  });

  /** The whole reason the spec exists: 8 v 7 is worth the same as 1 v 1. */
  it('pays the same once in a clash of 8 against 7', () => {
    const awards = computeTeamAwards(
      duel({
        participants: [
          ...Array.from({ length: 8 }, () => ({ sideIndex: 1, teamId: JULIEN })),
          ...Array.from({ length: 7 }, () => ({ sideIndex: 2, teamId: PIERRE })),
        ],
      }),
    );
    expect(awards).toEqual([
      { teamId: JULIEN, type: 'match_win', points: 10, detail: 'Victoire — Palet' },
    ]);
  });

  it('adds the margin bonus once, not once per winner', () => {
    const awards = computeTeamAwards(
      duel({
        rules: withBonus,
        participants: [
          { sideIndex: 1, teamId: JULIEN },
          { sideIndex: 1, teamId: JULIEN },
          { sideIndex: 2, teamId: PIERRE },
          { sideIndex: 2, teamId: PIERRE },
        ],
      }),
    );
    expect(awards).toHaveLength(2);
    expect(awards[1]).toEqual({
      teamId: JULIEN,
      type: 'margin_bonus',
      points: 11,
      detail: 'Écart 13–2 × 1 pt',
    });
  });

  it('pays nothing when two players of the same team face each other', () => {
    expect(
      computeTeamAwards(
        duel({
          participants: [
            { sideIndex: 1, teamId: JULIEN },
            { sideIndex: 2, teamId: JULIEN },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('pays nothing when a player has no team', () => {
    expect(
      computeTeamAwards(
        duel({
          participants: [
            { sideIndex: 1, teamId: null },
            { sideIndex: 2, teamId: PIERRE },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('pays nothing when a side is mixed', () => {
    expect(
      computeTeamAwards(
        duel({
          participants: [
            { sideIndex: 1, teamId: JULIEN },
            { sideIndex: 1, teamId: PIERRE },
            { sideIndex: 2, teamId: PIERRE },
            { sideIndex: 2, teamId: PIERRE },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('pays nothing when the winning side is not one of the two teams', () => {
    expect(computeTeamAwards(duel({ winningSide: 3 }))).toEqual([]);
  });
});

describe('computeTeamReversals (rule 23)', () => {
  it('is the exact negative of what the match paid, one row per team', () => {
    expect(
      computeTeamReversals(
        [
          { teamId: JULIEN, points: 10 },
          { teamId: JULIEN, points: 11 },
        ],
        'Palet',
      ),
    ).toEqual([
      {
        teamId: JULIEN,
        type: 'match_reversal',
        points: -21,
        detail: 'Partie annulée par un admin — Palet',
      },
    ]);
  });

  it('writes nothing for a match that paid nothing', () => {
    expect(computeTeamReversals([], 'Palet')).toEqual([]);
  });
});

describe('the team standings (rules 28-29)', () => {
  const julien = { teamId: JULIEN, name: 'Équipe Julien', points: 30, matchesWon: 3 };
  const pierre = { teamId: PIERRE, name: 'Équipe Pierre', points: 30, matchesWon: 2 };

  it('orders by points, then matches won, then name', () => {
    expect(compareTeamStandings(julien, pierre)).toBeLessThan(0);
    expect(
      compareTeamStandings({ ...julien, points: 10 }, pierre),
    ).toBeGreaterThan(0);
    expect(
      compareTeamStandings({ ...julien, matchesWon: 2 }, pierre),
    ).toBeLessThan(0);
  });

  it('shows a tie as a tie', () => {
    const ranked = rankTeamStandings([julien, { ...pierre, matchesWon: 3 }]);
    expect(ranked.map((team) => team.rank)).toEqual([1, 1]);
  });

  it('ranks the leader first whatever order it is given in', () => {
    const ranked = rankTeamStandings([pierre, julien]);
    expect(ranked[0]?.teamId).toBe(JULIEN);
    expect(ranked.map((team) => team.rank)).toEqual([1, 2]);
  });
});
