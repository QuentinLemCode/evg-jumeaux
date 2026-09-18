/**
 * Seeds the roster and the default games (specs 0002, 0003).
 *
 * Idempotent and additive: it inserts what is missing and updates what
 * changed, and never deletes a player — deleting one would orphan the matches
 * and the points they are part of.
 */
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { db } from '../index';
import { games, users } from '../schema';
import { seedGames } from './games';
import { DEV_PIN, seedUsers, type SeedUser } from './users';
import { e2eUsers } from './users.e2e';


function fail(message: string): never {
  console.error(`seed: ${message}`);
  process.exit(1);
}

/**
 * Which roster to seed. The end-to-end suite asks for its own (see
 * `users.e2e.ts`); everything else gets the real guest list.
 *
 * Refused in production, because seeding the test roster there would put nine
 * players with one publicly known PIN into the real database.
 */
const roster: SeedUser[] = (() => {
  if (process.env.SEED_ROSTER !== 'e2e') return seedUsers;
  if (process.env.NODE_ENV === 'production') {
    fail('SEED_ROSTER=e2e refuses to run with NODE_ENV=production');
  }
  return e2eUsers;
})();

function validate(): void {
  const ids = new Set<string>();
  for (const user of roster) {
    if (ids.has(user.id)) fail(`duplicate user id '${user.id}'`);
    ids.add(user.id);
    if (!/^[a-z0-9-]+$/.test(user.id)) {
      fail(`user id '${user.id}' must be kebab-case`);
    }
    // A hash that is not a hash means someone pasted a PIN into the seed.
    if (!user.pinHash.startsWith('$2')) {
      fail(
        `user '${user.id}' has no bcrypt hash. Run: npm run hash-pin <pin> ` +
          `and paste the result into src/db/seed/users.ts`,
      );
    }
  }
  if (!roster.some((u) => u.role === 'admin')) {
    fail('the roster has no admin — at least one player must have role "admin"');
  }

  const usingDevPins = roster.some((u) => bcrypt.compareSync(DEV_PIN, u.pinHash));
  if (usingDevPins && process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEV_PINS) {
    fail(
      'the roster still uses the shared development PIN. Generate real PINs ' +
        'with `npm run hash-pin <pin>` before seeding production, or set ' +
        'ALLOW_DEV_PINS=1 if you really mean it.',
    );
  }
  if (usingDevPins) {
    console.warn(`seed: WARNING — some players still use the development PIN (${DEV_PIN})`);
  }
}

async function seed(): Promise<void> {
  validate();
  const now = Date.now();

  for (const user of roster) {
    const existing = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (existing.length === 0) {
      await db.insert(users).values({ ...user, createdAt: now });
      console.log(`seed: + user ${user.id}`);
    } else {
      await db
        .update(users)
        .set({ name: user.name, role: user.role, avatar: user.avatar, pinHash: user.pinHash })
        .where(eq(users.id, user.id));
      console.log(`seed: ~ user ${user.id}`);
    }
  }

  const [firstAdmin] = roster.filter((u) => u.role === 'admin');
  if (!firstAdmin) fail('unreachable: validated above');

  for (const game of seedGames) {
    const existing = await db.select().from(games).where(eq(games.slug, game.slug)).limit(1);
    if (existing.length === 0) {
      await db.insert(games).values({
        ...game,
        id: crypto.randomUUID(),
        isActive: true,
        createdBy: firstAdmin.id,
        createdAt: now,
        updatedAt: now,
      });
      console.log(`seed: + game ${game.slug}`);
    } else {
      // Scoring rules of existing games are left alone on purpose: an admin may
      // have tuned them from the app, and the seed must not undo that.
      console.log(`seed: = game ${game.slug} (left as configured)`);
    }
  }

  const seeded = await db.select().from(users);
  console.log(
    `seed: done — ${seeded.length} players ` +
      `(${seeded.filter((u) => u.role === 'admin').length} admin)`,
  );
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
