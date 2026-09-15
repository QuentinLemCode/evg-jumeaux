/**
 * The games the app ships with (spec 0003), so the leaderboard is usable the
 * minute the first person logs in. Admins add the rest from the app.
 */

export type SeedGame = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  mode: 'duel' | 'team';
  sidesCount: number;
  playersPerSide: number;
  pointsPerWin: number;
  marginBonusEnabled: boolean;
  marginBonusPerPoint: number;
  marginBonusCap: number | null;
  requiresScore: boolean;
};

export const seedGames: SeedGame[] = [
  {
    slug: 'palet',
    name: 'Palet',
    description: 'Premier à 13. Le palet le plus proche du maître marque.',
    icon: '🥏',
    mode: 'duel',
    sidesCount: 2,
    playersPerSide: 1,
    pointsPerWin: 10,
    marginBonusEnabled: true,
    marginBonusPerPoint: 1,
    marginBonusCap: 12,
    requiresScore: true,
  },
  {
    slug: 'pierre-feuille-ciseaux',
    name: 'Pierre-feuille-ciseaux',
    description: 'Au meilleur des 3 manches. Pas de score à saisir.',
    icon: '✂️',
    mode: 'duel',
    sidesCount: 2,
    playersPerSide: 1,
    pointsPerWin: 3,
    marginBonusEnabled: false,
    marginBonusPerPoint: 0,
    marginBonusCap: null,
    requiresScore: false,
  },
  {
    slug: 'flechettes',
    name: 'Fléchettes',
    description: 'Un 501, sortie libre.',
    icon: '🎯',
    mode: 'duel',
    sidesCount: 2,
    playersPerSide: 1,
    pointsPerWin: 8,
    marginBonusEnabled: false,
    marginBonusPerPoint: 0,
    marginBonusCap: null,
    requiresScore: false,
  },
  {
    slug: 'petanque',
    name: 'Pétanque',
    description: 'Triplettes, premier à 13.',
    icon: '⚪',
    mode: 'team',
    sidesCount: 2,
    playersPerSide: 3,
    pointsPerWin: 12,
    marginBonusEnabled: true,
    marginBonusPerPoint: 1,
    marginBonusCap: 12,
    requiresScore: true,
  },
  {
    slug: 'beer-pong',
    name: 'Beer pong',
    description: 'Doublettes, 10 gobelets par camp.',
    icon: '🍺',
    mode: 'team',
    sidesCount: 2,
    playersPerSide: 2,
    pointsPerWin: 15,
    marginBonusEnabled: true,
    marginBonusPerPoint: 2,
    marginBonusCap: 10,
    requiresScore: true,
  },
];
