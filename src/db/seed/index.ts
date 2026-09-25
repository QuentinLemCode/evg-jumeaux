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
import { games, teams, users } from '../schema';
import { seedGames } from './games';
import { seedCaptains, seedTeams, type Captains } from './teams';
import { seedRoster, type SeedUser } from './users';
import { DEV_PIN, e2eCaptains, e2eUsers } from './users.e2e';


function fail(message: string): never {
  console.error(`seed: ${message}`);
  process.exit(1);
}

/**
 * Where the PIN hashes come from (spec 0002, rules 6-7).
 *
 * NOT from the repository. A 6-digit PIN is a million possibilities, and
 * bcrypt at cost 12 runs at thousands of guesses a second on one GPU: a
 * published hash is a PIN anyone recovers in minutes, and the escalating
 * lockout cannot help because the attack never touches the login form.
 *
 * `SEED_PIN_HASHES` is a JSON object of id -> bcrypt hash, produced by
 * `npm run generate-users` alongside the roster itself.
 */
/**
 * A complete bcrypt hash: `$2b$12$` plus exactly 53 characters of salt and
 * digest. Checked in full, not by its prefix, because of the failure below.
 */
const BCRYPT = /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/;

function pinHashesFromEnv(): Map<string, string> {
  const raw = process.env.SEED_PIN_HASHES?.trim();
  if (!raw) {
    fail(
      'SEED_PIN_HASHES is not set. Generate it with ' +
        '`npm run generate-users -- <roster-file>` and set it as a secret ' +
        '(GitHub) or in the VM environment.',
    );
  }

  // Base64 is the transport, because a bcrypt hash starts with `$2b$12$` and
  // Docker Compose interpolates `$` in the project `.env` it also uses as an
  // env_file: raw JSON arrives as `{"id":"$2b$12"}`, silently truncated. That
  // still looked like a hash to a prefix check, so it would have seeded
  // unusable hashes and failed every login with nothing to point at.
  // Raw JSON is still accepted, for a local shell where it is safe.
  let text = raw;
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(raw, 'base64').toString('utf8');
    } catch {
      fail('SEED_PIN_HASHES is neither JSON nor base64-encoded JSON.');
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('SEED_PIN_HASHES did not decode to valid JSON. Expected {"id": "$2b$12$..."}.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('SEED_PIN_HASHES must be a JSON object of id -> bcrypt hash.');
  }

  const hashes = new Map<string, string>();
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      fail(`SEED_PIN_HASHES['${id}'] is not a string.`);
    }
    if (!BCRYPT.test(value)) {
      fail(
        `SEED_PIN_HASHES['${id}'] is not a complete bcrypt hash ` +
          `(got ${value.length} characters, expected 60). ` +
          'If it was passed as raw JSON through a Docker Compose .env, the ' +
          'dollar signs were eaten — pass it base64-encoded.',
      );
    }
    hashes.set(id, value);
  }
  return hashes;
}

/**
 * Which roster to seed. The end-to-end suite asks for its own (see
 * `users.e2e.ts`); everything else gets the real guest list, with each hash
 * resolved from the secret.
 */
const isE2eRoster = process.env.SEED_ROSTER === 'e2e';

/**
 * Who captains which team (spec 0017, rule 8). The end-to-end roster has
 * neither twin in it, so it names its own two.
 */
const captains: Captains = isE2eRoster ? e2eCaptains : seedCaptains;

const roster: SeedUser[] = (() => {
  if (isE2eRoster) {
    // The invariant is about the DATABASE, not the mode: the suite runs a
    // production build with NODE_ENV=production on purpose, against a
    // throwaway file that `scripts/e2e-prepare.mjs` creates and deletes.
    const target = process.env.DATABASE_PATH ?? '';
    if (!/(^|\/)\.e2e(\/|$)/.test(target)) {
      fail(
        `SEED_ROSTER=e2e only seeds the throwaway database under .e2e/ — ` +
          `DATABASE_PATH is '${target || '(unset)'}'`,
      );
    }
    return e2eUsers;
  }

  const hashes = pinHashesFromEnv();
  const missing = seedRoster.filter((u) => !hashes.has(u.id)).map((u) => u.id);
  if (missing.length > 0) {
    fail(
      `SEED_PIN_HASHES has no entry for: ${missing.join(', ')}. ` +
        'Regenerate it from the same roster file.',
    );
  }
  const extra = [...hashes.keys()].filter((id) => !seedRoster.some((u) => u.id === id));
  if (extra.length > 0) {
    // Not fatal: a departed guest keeps their rows, so a stale hash is
    // harmless. Worth saying, because it usually means a stale secret.
    console.warn(`seed: SEED_PIN_HASHES has entries not in the roster: ${extra.join(', ')}`);
  }

  return seedRoster.map((entry) => ({ ...entry, pinHash: hashes.get(entry.id)! }));
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

  // The two teams already exist: the MIGRATION inserts them, with a null
  // captain, because the deploy migrates and never seeds (spec 0017).
  const teamRows = await db.select().from(teams);
  const teamIdBySlug = new Map(teamRows.map((team) => [team.slug, team.id]));

  for (const user of roster) {
    // A pre-assigned team can be defined in the seed: when set, the player
    // is placed immediately and skips the choice screen upon first login.
    const teamId = user.teamSlug ? (teamIdBySlug.get(user.teamSlug) ?? null) : null;
    if (user.teamSlug && teamId === null) {
      fail(`user '${user.id}' names team '${user.teamSlug}', which is not seeded`);
    }

    const existing = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (existing.length === 0) {
      await db.insert(users).values({
        id: user.id,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
        pinHash: user.pinHash,
        teamId,
        createdAt: now,
      });
      console.log(`seed: + user ${user.id}${user.teamSlug ? ` (team: ${user.teamSlug})` : ''}`);
    } else {
      await db
        .update(users)
        .set({
          name: user.name,
          role: user.role,
          avatar: user.avatar,
          pinHash: user.pinHash,
          ...(teamId === null ? {} : { teamId }),
        })
        .where(eq(users.id, user.id));
      console.log(`seed: ~ user ${user.id}${user.teamSlug ? ` (team: ${user.teamSlug})` : ''}`);
    }
  }

  // The captains and accents, now that the players exist. A team whose captain
  // is not in this roster keeps a null captain and works exactly as well (rule 8).
  for (const team of teamRows) {
    const captainId = captains[team.slug];
    const teamDef = seedTeams.find((t) => t.slug === team.slug);
    const updates: { accent?: string; captainId?: string } = {};

    if (teamDef && team.accent !== teamDef.accent) {
      updates.accent = teamDef.accent;
    }

    if (captainId && roster.some((user) => user.id === captainId)) {
      updates.captainId = captainId;
      await db.update(teams).set(updates).where(eq(teams.id, team.id));
      // A captain is seeded onto their own team and never chooses (rule 9).
      await db.update(users).set({ teamId: team.id }).where(eq(users.id, captainId));
      console.log(`seed: ~ team ${team.slug} captained by ${captainId} (accent: ${teamDef?.accent ?? team.accent})`);
    } else {
      if (captainId) {
        console.log(`seed: = team ${team.slug} (captain '${captainId}' not in this roster)`);
      }
      if (Object.keys(updates).length > 0) {
        await db.update(teams).set(updates).where(eq(teams.id, team.id));
      }
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
