/**
 * The roster (spec 0002).
 *
 * This list is the whole user database. There is no sign-up: adding someone to
 * the weekend means adding a line here and re-running `npm run db:seed`.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ NO PIN OR PIN HASH BELONGS IN THIS FILE.                                │
 * │                                                                         │
 * │ A 6-digit PIN has a million possibilities, and bcrypt at cost 12 runs   │
 * │ at thousands of guesses a second on one GPU — so a published hash is    │
 * │ a PIN anyone can recover in minutes. The escalating lockout defends     │
 * │ the login form; it does nothing for a hash someone already has.         │
 * │                                                                         │
 * │ Hashes therefore live in the SEED_PIN_HASHES secret, keyed by id.       │
 * │ `npm run generate-users -- <roster-file>` writes this file and that     │
 * │ secret from the same input.                                             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The end-to-end suite does NOT use this list — it has its own roster in
 * `users.e2e.ts`, so changing the guests cannot break the tests and the tests
 * never need a real guest's PIN.
 *
 * `id` is a permanent identifier: matches and points reference it forever.
 * Never reuse an id for a different person.
 */

/** A player as the repository knows them: everything except their secret. */
export type RosterEntry = {
  id: string;
  name: string;
  role: 'admin' | 'user';
  avatar: string;
};

/**
 * What the seeder actually writes, once a hash has been resolved for each.
 *
 * `teamSlug` is NOT part of `RosterEntry`, and deliberately: `generate-users`
 * rewrites the roster block below wholesale, so anything it does not know how
 * to write would be silently dropped on the next run. Real guests choose
 * their own team in the app (spec 0017, rule 10); only the end-to-end roster
 * arrives pre-placed, so the nine existing suites are not all sent to the
 * choice screen.
 */
export type SeedUser = RosterEntry & { pinHash: string; teamSlug?: string };

// generate-users:begin — replaced wholesale by `npm run generate-users`.
export const seedRoster: RosterEntry[] = [
  { id: 'quentin', name: 'Quentin', role: 'admin', avatar: '🧠' },
  { id: 'pablo', name: 'Pablo', role: 'admin', avatar: '👑' },
  { id: 'ravno', name: 'Ravno', role: 'user', avatar: '🐻' },
  { id: 'gabriel', name: 'Gabriel', role: 'user', avatar: '🦊' },
  { id: 'benjamin', name: 'Benjamin', role: 'user', avatar: '🦉' },
  { id: 'alex', name: 'Alex', role: 'user', avatar: '🐺' },
  { id: 'arthur', name: 'Arthur', role: 'user', avatar: '🦁' },
  { id: 'felix', name: 'Félix', role: 'user', avatar: '🐯' },
  { id: 'nemo', name: 'Némo', role: 'user', avatar: '🦅' },
  { id: 'garreau', name: 'Garreau', role: 'user', avatar: '🐗' },
  { id: 'robin', name: 'Robin', role: 'user', avatar: '🦌' },
  { id: 'tim', name: 'Tim', role: 'user', avatar: '🐸' },
  { id: 'tom', name: 'Tom', role: 'user', avatar: '🦈' },
  { id: 'julien', name: 'Julien', role: 'user', avatar: '🐙' },
  { id: 'pierre', name: 'Pierre', role: 'user', avatar: '🦄' },
];
// generate-users:end
