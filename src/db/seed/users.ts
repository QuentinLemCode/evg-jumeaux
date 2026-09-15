/**
 * The roster (spec 0002).
 *
 * This list is the whole user database. There is no sign-up: adding someone to
 * the weekend means adding a line here and re-running `npm run db:seed`.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ BEFORE THE PARTY, DO THIS:                                              │
 * │                                                                         │
 * │   1. Replace the names, ids and avatars below with the real guests.     │
 * │   2. For each of them, pick a 6-digit PIN and run:                      │
 * │        npm run hash-pin 482915                                          │
 * │   3. Paste the printed hash as their `pinHash`.                          │
 * │   4. Send each person their own PIN privately. Never commit the PINs.    │
 * │                                                                         │
 * │ Every hash below is currently the shared development PIN. Seeding      │
 * │ refuses to run with those hashes when NODE_ENV=production, so the app  │
 * │ cannot accidentally go live with a PIN everybody knows.                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * `id` is a permanent identifier: matches and points reference it forever.
 * Never reuse an id for a different person.
 */

export const DEV_PIN = '123456';

export type SeedUser = {
  id: string;
  name: string;
  role: 'admin' | 'user';
  avatar: string;
  pinHash: string;
};

const DEV_PIN_HASH = '$2b$12$qM/eqAqm1MwcNsCaIrr2r.GKJrCf8pb1EQ1crncDgRiqmFdkq4Ope';

export const seedUsers: SeedUser[] = [
  { id: 'quentin', name: 'Quentin', role: 'admin', avatar: '🧠', pinHash: DEV_PIN_HASH },
  { id: 'jumeau-1', name: 'Jumeau 1', role: 'admin', avatar: '👑', pinHash: DEV_PIN_HASH },
  { id: 'jumeau-2', name: 'Jumeau 2', role: 'admin', avatar: '👑', pinHash: DEV_PIN_HASH },
  { id: 'antoine', name: 'Antoine', role: 'user', avatar: '🐻', pinHash: DEV_PIN_HASH },
  { id: 'baptiste', name: 'Baptiste', role: 'user', avatar: '🦊', pinHash: DEV_PIN_HASH },
  { id: 'clement', name: 'Clément', role: 'user', avatar: '🦉', pinHash: DEV_PIN_HASH },
  { id: 'hugo', name: 'Hugo', role: 'user', avatar: '🐺', pinHash: DEV_PIN_HASH },
  { id: 'julien', name: 'Julien', role: 'user', avatar: '🦁', pinHash: DEV_PIN_HASH },
  { id: 'lucas', name: 'Lucas', role: 'user', avatar: '🐯', pinHash: DEV_PIN_HASH },
  { id: 'mathieu', name: 'Mathieu', role: 'user', avatar: '🦅', pinHash: DEV_PIN_HASH },
  { id: 'nicolas', name: 'Nicolas', role: 'user', avatar: '🐗', pinHash: DEV_PIN_HASH },
  { id: 'pierre', name: 'Pierre', role: 'user', avatar: '🦌', pinHash: DEV_PIN_HASH },
  { id: 'romain', name: 'Romain', role: 'user', avatar: '🐸', pinHash: DEV_PIN_HASH },
  { id: 'thomas', name: 'Thomas', role: 'user', avatar: '🦈', pinHash: DEV_PIN_HASH },
];
