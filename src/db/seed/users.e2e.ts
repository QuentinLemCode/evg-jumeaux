/**
 * The roster the END-TO-END SUITE runs against (spec 0002).
 *
 * Separate from `users.ts` on purpose, and the separation is load-bearing:
 *
 *  - `users.ts` is the real guest list. It changes whenever the invitations
 *    change, and every change used to break the suite — the tests hardcoded
 *    names that had stopped existing.
 *  - Real PINs are real secrets. A suite that logs in with them cannot be run
 *    anywhere the guests' PINs should not be, CI included.
 *
 * So the suite gets nine fixed players who share one publicly known PIN. The
 * database they live in is created and destroyed by `scripts/e2e-prepare.mjs`;
 * seeding this roster is refused outright when NODE_ENV=production.
 *
 * Nine, not two, because the login lockout ladder is in memory and is never
 * reset between tests: a test that fails a PIN on purpose needs a player no
 * other test touches (AGENTS.md §9).
 *
 * TEAMS are assigned here (spec 0017): every player but Thomas starts placed,
 * or the team gate would send all nine existing suites to the choice screen.
 * The split is 5 and 3 with the captains counted, so "one team is a player
 * ahead" is reachable — and Thomas is the one guest with no team, for the
 * choice journey itself.
 */
import type { Captains } from './teams';
import type { SeedUser } from './users';

/** The PIN every E2E player shares. Public by design; test data only. */
export const DEV_PIN = '123456';

/** bcrypt of DEV_PIN. */
const E2E_PIN_HASH = '$2b$12$qM/eqAqm1MwcNsCaIrr2r.GKJrCf8pb1EQ1crncDgRiqmFdkq4Ope';

export const e2eUsers: SeedUser[] = [
  { id: 'quentin', name: 'Quentin', role: 'admin', avatar: '🧠', pinHash: E2E_PIN_HASH, teamSlug: 'julien' },
  { id: 'jumeau-1', name: 'Jumeau 1', role: 'admin', avatar: '👑', pinHash: E2E_PIN_HASH, teamSlug: 'pierre' },
  { id: 'antoine', name: 'Antoine', role: 'user', avatar: '🐻', pinHash: E2E_PIN_HASH, teamSlug: 'julien' },
  { id: 'baptiste', name: 'Baptiste', role: 'user', avatar: '🦊', pinHash: E2E_PIN_HASH, teamSlug: 'julien' },
  { id: 'clement', name: 'Clément', role: 'user', avatar: '🦉', pinHash: E2E_PIN_HASH, teamSlug: 'julien' },
  { id: 'hugo', name: 'Hugo', role: 'user', avatar: '🐺', pinHash: E2E_PIN_HASH, teamSlug: 'julien' },
  { id: 'lucas', name: 'Lucas', role: 'user', avatar: '🐯', pinHash: E2E_PIN_HASH, teamSlug: 'pierre' },
  { id: 'romain', name: 'Romain', role: 'user', avatar: '🐸', pinHash: E2E_PIN_HASH, teamSlug: 'pierre' },
  // No team: the choice journey needs somebody who has not chosen.
  { id: 'thomas', name: 'Thomas', role: 'user', avatar: '🦈', pinHash: E2E_PIN_HASH },
];

/**
 * The end-to-end captains. Neither twin is in this roster, so the two teams
 * are captained by the two admins — which is also what makes the "a captain
 * is offered no choice" journey runnable (rule 8).
 */
export const e2eCaptains: Captains = {
  julien: 'quentin',
  pierre: 'jumeau-1',
};
