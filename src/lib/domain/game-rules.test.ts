import { describe, expect, it } from 'vitest';

import {
  normaliseGameDefinition,
  scoringRulesFor,
  slugify,
  validateGameDefinition,
  type GameDefinition,
} from './game-rules';

function definition(overrides: Partial<GameDefinition> = {}): GameDefinition {
  return {
    name: 'Palet',
    mode: 'duel',
    sidesCount: 2,
    playersPerSide: 1,
    pointsPerWin: 10,
    marginBonusEnabled: false,
    marginBonusPerPoint: 0,
    marginBonusCap: null,
    ...overrides,
  };
}

const fields = (errors: { field: string }[]) => errors.map((e) => e.field);

describe('validateGameDefinition', () => {
  it('accepts a plain duel', () => {
    expect(validateGameDefinition(definition())).toEqual([]);
  });

  it('accepts a team game', () => {
    expect(
      validateGameDefinition(definition({ mode: 'team', playersPerSide: 3 })),
    ).toEqual([]);
  });

  /**
   * The bug spec 0017 had to correct: the size checks below made a clash
   * impossible to create, because two teams of 8 and 7 can never satisfy one
   * `playersPerSide` (rule 2).
   */
  it('accepts a clash, whose sides are the two teams and need not match', () => {
    expect(
      validateGameDefinition(definition({ mode: 'clash', playersPerSide: 1 })),
    ).toEqual([]);
  });

  it('rejects a clash with anything but two sides', () => {
    expect(
      fields(validateGameDefinition(definition({ mode: 'clash', sidesCount: 3 }))),
    ).toContain('sidesCount');
  });

  it('rejects a duel with several players per side', () => {
    expect(fields(validateGameDefinition(definition({ playersPerSide: 2 })))).toContain(
      'playersPerSide',
    );
  });

  it('rejects a team game with a single player per side', () => {
    expect(
      fields(validateGameDefinition(definition({ mode: 'team', playersPerSide: 1 }))),
    ).toContain('playersPerSide');
  });

  it('rejects fewer than two sides', () => {
    expect(fields(validateGameDefinition(definition({ sidesCount: 1 })))).toContain(
      'sidesCount',
    );
  });

  it('rejects more than four sides', () => {
    expect(fields(validateGameDefinition(definition({ sidesCount: 5 })))).toContain(
      'sidesCount',
    );
  });

  it('rejects zero points per win', () => {
    expect(fields(validateGameDefinition(definition({ pointsPerWin: 0 })))).toContain(
      'pointsPerWin',
    );
  });

  it('rejects a margin bonus worth nothing per point', () => {
    expect(
      fields(
        validateGameDefinition(
          definition({ marginBonusEnabled: true, marginBonusPerPoint: 0 }),
        ),
      ),
    ).toContain('marginBonusPerPoint');
  });

  it('rejects a name that is too short', () => {
    expect(fields(validateGameDefinition(definition({ name: 'X' })))).toContain('name');
  });
});

describe('normaliseGameDefinition', () => {
  it('forces scores on when the margin bonus is enabled', () => {
    const result = normaliseGameDefinition({
      ...definition({ marginBonusEnabled: true, marginBonusPerPoint: 2 }),
      requiresScore: false,
    });
    expect(result.requiresScore).toBe(true);
  });

  it('forces one player per side for a duel', () => {
    const result = normaliseGameDefinition({
      ...definition({ mode: 'duel', playersPerSide: 4 }),
      requiresScore: false,
    });
    expect(result.playersPerSide).toBe(1);
  });

  it('zeroes the bonus configuration when the bonus is disabled', () => {
    const result = normaliseGameDefinition({
      ...definition({
        marginBonusEnabled: false,
        marginBonusPerPoint: 5,
        marginBonusCap: 10,
      }),
      requiresScore: true,
    });
    expect(result.marginBonusPerPoint).toBe(0);
    expect(result.marginBonusCap).toBeNull();
  });
});

describe('normaliseGameDefinition — a clash', () => {
  it('stores one player per side and two sides, whatever was submitted', () => {
    const stored = normaliseGameDefinition({
      ...definition({ mode: 'clash', playersPerSide: 6, sidesCount: 4 }),
      requiresScore: false,
    });
    expect(stored.playersPerSide).toBe(1);
    expect(stored.sidesCount).toBe(2);
  });
});

describe('scoringRulesFor', () => {
  it('drops the bonus from the snapshot when it is disabled', () => {
    expect(
      scoringRulesFor({
        pointsPerWin: 10,
        marginBonusEnabled: false,
        marginBonusPerPoint: 3,
        marginBonusCap: 9,
        requiresScore: true,
      }),
    ).toEqual({
      pointsPerWin: 10,
      marginBonusPerPoint: 0,
      marginBonusCap: null,
      requiresScore: true,
    });
  });

  it('keeps the bonus when it is enabled', () => {
    expect(
      scoringRulesFor({
        pointsPerWin: 15,
        marginBonusEnabled: true,
        marginBonusPerPoint: 2,
        marginBonusCap: 10,
        requiresScore: true,
      }),
    ).toEqual({
      pointsPerWin: 15,
      marginBonusPerPoint: 2,
      marginBonusCap: 10,
      requiresScore: true,
    });
  });
});

describe('slugify', () => {
  it('strips accents and punctuation', () => {
    expect(slugify('Pétanque à l’ancienne !')).toBe('petanque-a-l-ancienne');
  });

  it('collapses separators', () => {
    expect(slugify('Pierre — Feuille — Ciseaux')).toBe('pierre-feuille-ciseaux');
  });
});
