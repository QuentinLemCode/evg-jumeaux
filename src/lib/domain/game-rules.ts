/**
 * Game shape and scoring validation (spec 0003).
 *
 * Kept pure and separate from the Server Action so the rules can be unit
 * tested and reused by both the create and the edit paths.
 */
import type { GameMode, ScoringRules } from './types';

export type GameDefinition = {
  name: string;
  mode: GameMode;
  sidesCount: number;
  playersPerSide: number;
  pointsPerWin: number;
  marginBonusEnabled: boolean;
  marginBonusPerPoint: number;
  marginBonusCap: number | null;
};

export const GAME_LIMITS = {
  sidesCount: { min: 2, max: 4 },
  playersPerSide: { min: 1, max: 6 },
  pointsPerWin: { min: 1, max: 100 },
  marginBonusPerPoint: { min: 0, max: 20 },
} as const;

export type GameRuleError = { field: keyof GameDefinition; message: string };

export function validateGameDefinition(game: GameDefinition): GameRuleError[] {
  const errors: GameRuleError[] = [];

  if (game.name.trim().length < 2) {
    errors.push({ field: 'name', message: 'Le nom doit faire au moins 2 caractères' });
  }
  if (
    !Number.isInteger(game.sidesCount) ||
    game.sidesCount < GAME_LIMITS.sidesCount.min ||
    game.sidesCount > GAME_LIMITS.sidesCount.max
  ) {
    errors.push({ field: 'sidesCount', message: 'Entre 2 et 4 camps' });
  }
  if (game.mode === 'duel' && game.playersPerSide !== 1) {
    errors.push({ field: 'playersPerSide', message: 'Un duel oppose des joueurs seuls' });
  }
  if (game.mode === 'team' && game.playersPerSide < 2) {
    errors.push({ field: 'playersPerSide', message: 'Un camp d’équipe compte au moins 2 joueurs' });
  }
  // A clash is the two teams in full, so it has exactly two sides and its
  // `playersPerSide` is never read (spec 0017, rule 1). The size checks above
  // deliberately do not apply to it: a validator that demands equal sides
  // makes a 8 v 7 impossible to create, which is the bug 0017 corrects.
  if (game.mode === 'clash' && game.sidesCount !== 2) {
    errors.push({ field: 'sidesCount', message: 'Un choc oppose les deux équipes' });
  }
  if (game.playersPerSide > GAME_LIMITS.playersPerSide.max) {
    errors.push({ field: 'playersPerSide', message: 'Maximum 6 joueurs par camp' });
  }
  if (
    !Number.isInteger(game.pointsPerWin) ||
    game.pointsPerWin < GAME_LIMITS.pointsPerWin.min ||
    game.pointsPerWin > GAME_LIMITS.pointsPerWin.max
  ) {
    errors.push({ field: 'pointsPerWin', message: 'Entre 1 et 100 points' });
  }
  if (game.marginBonusEnabled) {
    if (game.marginBonusPerPoint < 1) {
      errors.push({
        field: 'marginBonusPerPoint',
        message: 'Indique combien de points rapporte chaque point d’écart',
      });
    }
    if (game.marginBonusPerPoint > GAME_LIMITS.marginBonusPerPoint.max) {
      errors.push({ field: 'marginBonusPerPoint', message: 'Maximum 20 points par écart' });
    }
    if (game.marginBonusCap !== null && game.marginBonusCap < 1) {
      errors.push({ field: 'marginBonusCap', message: 'Le plafond doit être positif' });
    }
  }

  return errors;
}

/**
 * The stored form of a validated definition. A margin bonus is impossible
 * without scores, so enabling it forces `requiresScore` on rather than letting
 * an admin save a configuration that can never produce a bonus
 * (spec 0003, rule 3).
 */
export function normaliseGameDefinition(
  game: GameDefinition & { requiresScore: boolean },
): GameDefinition & { requiresScore: boolean } {
  // A duel is one player a side, and a clash stores 1 and never reads it
  // (spec 0017, rule 2).
  const playersPerSide = game.mode === 'duel' || game.mode === 'clash' ? 1 : game.playersPerSide;
  const sidesCount = game.mode === 'clash' ? 2 : game.sidesCount;
  const marginBonusPerPoint = game.marginBonusEnabled ? game.marginBonusPerPoint : 0;
  return {
    ...game,
    playersPerSide,
    sidesCount,
    marginBonusPerPoint,
    marginBonusCap: game.marginBonusEnabled ? game.marginBonusCap : null,
    requiresScore: game.marginBonusEnabled ? true : game.requiresScore,
  };
}

/** The snapshot written onto a new match (spec 0005, rule 13). */
export function scoringRulesFor(game: {
  pointsPerWin: number;
  marginBonusEnabled: boolean;
  marginBonusPerPoint: number;
  marginBonusCap: number | null;
  requiresScore: boolean;
}): ScoringRules {
  return {
    pointsPerWin: game.pointsPerWin,
    marginBonusPerPoint: game.marginBonusEnabled ? game.marginBonusPerPoint : 0,
    marginBonusCap: game.marginBonusEnabled ? game.marginBonusCap : null,
    requiresScore: game.requiresScore,
  };
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
