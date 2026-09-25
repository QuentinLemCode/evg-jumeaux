/**
 * The two teams and their captains (spec 0017, rules 8-10).
 *
 * The ROWS are created by the migration, not here: the deploy migrates and
 * never seeds, so they have to exist before anybody can choose. What the
 * seeder owns is the CAPTAIN, and it has to be that way round — the migration
 * runs against an empty `users` table with `foreign_keys` ON, so naming a
 * player there would fail with a foreign-key error on every fresh database.
 *
 * A team whose captain is not in the roster being seeded simply keeps a null
 * captain. That is not a degraded state: the end-to-end roster has neither
 * twin in it, and it works.
 */

/** Team slug → the id of the player who captains it. */
export type Captains = Record<string, string>;

export const TEAM_SLUGS = ['julien', 'pierre'] as const;

export type SeedTeam = {
  slug: (typeof TEAM_SLUGS)[number];
  name: string;
  accent: 'coral' | 'sky';
  captainId: string;
};

export const seedTeams: readonly SeedTeam[] = [
  { slug: 'julien', name: 'Équipe Julien', accent: 'coral', captainId: 'julien' },
  { slug: 'pierre', name: 'Équipe Pierre', accent: 'sky', captainId: 'pierre' },
] as const;

/** The real weekend: each twin heads the team that carries their name. */
export const seedCaptains: Captains = {
  julien: 'julien',
  pierre: 'pierre',
};

