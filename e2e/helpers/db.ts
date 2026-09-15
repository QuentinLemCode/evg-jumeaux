/**
 * Direct database access for the end-to-end suite.
 *
 * Two jobs only:
 *
 *  - **reset** the volatile state between tests, so a test never depends on
 *    what the previous one left behind;
 *  - **build the fixtures the UI genuinely cannot build**, which is exactly
 *    one thing: an invitation that has already expired. Waiting five real
 *    minutes is not a test.
 *
 * Everything else goes through the interface. A test that seeds a completed
 * match to assert points would pass while the real flow was broken.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const DB_PATH = process.env.DATABASE_PATH ?? './.e2e/evg.db';

/** Games that ship with the seed. Anything else was created by a test. */
export const SEED_GAME_SLUGS = [
  'palet',
  'pierre-feuille-ciseaux',
  'flechettes',
  'petanque',
  'beer-pong',
];

function open() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Clears everything a test can create, and leaves the seeded roster and the
 * seeded games. Child rows first, because foreign keys are on.
 */
export function resetVolatileState(): void {
  const db = open();
  try {
    db.exec(`
      DELETE FROM notifications;
      DELETE FROM point_events;
      DELETE FROM match_participants;
      DELETE FROM match_sides;
      DELETE FROM matches;
      DELETE FROM push_subscriptions;
    `);
    const placeholders = SEED_GAME_SLUGS.map(() => '?').join(',');
    db.prepare(`DELETE FROM games WHERE slug NOT IN (${placeholders})`).run(...SEED_GAME_SLUGS);
    // Re-activate anything a test archived.
    db.prepare(`UPDATE games SET is_active = 1 WHERE slug IN (${placeholders})`).run(
      ...SEED_GAME_SLUGS,
    );
  } finally {
    db.close();
  }
}

export function gameIdBySlug(slug: string): string {
  const db = open();
  try {
    const row = db.prepare('SELECT id FROM games WHERE slug = ?').get(slug) as
      | { id: string }
      | undefined;
    if (!row) throw new Error(`no game with slug '${slug}' — was the seed run?`);
    return row.id;
  } finally {
    db.close();
  }
}

/**
 * A pending duel whose 5-minute window has ALREADY closed (spec 0004, rule
 * 13). The only fixture the UI cannot produce, because producing it through
 * the UI means waiting five minutes.
 */
export function createExpiredInvitation(options: {
  gameSlug: string;
  from: string;
  to: string;
}): string {
  const db = open();
  try {
    const game = db
      .prepare('SELECT * FROM games WHERE slug = ?')
      .get(options.gameSlug) as Record<string, number | string | null> | undefined;
    if (!game) throw new Error(`no game with slug '${options.gameSlug}'`);

    const matchId = randomUUID();
    const now = Date.now();
    // Created ten minutes ago, so the five-minute deadline is long gone.
    const createdAt = now - 10 * 60_000;

    db.prepare(
      `INSERT INTO matches (
         id, game_id, created_by, status, invitation_expires_at,
         rule_points_per_win, rule_margin_bonus_per_point, rule_margin_bonus_cap,
         rule_requires_score, created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      matchId,
      game.id,
      options.from,
      createdAt + 5 * 60_000,
      game.points_per_win,
      game.margin_bonus_enabled ? game.margin_bonus_per_point : 0,
      game.margin_bonus_enabled ? game.margin_bonus_cap : null,
      game.requires_score,
      createdAt,
      createdAt,
    );

    const nameOf = (id: string) =>
      (db.prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string }).name;

    db.prepare(
      'INSERT INTO match_sides (match_id, side_index, label, score, validated_at, validated_by) VALUES (?, 1, ?, NULL, NULL, NULL)',
    ).run(matchId, nameOf(options.from));
    db.prepare(
      'INSERT INTO match_sides (match_id, side_index, label, score, validated_at, validated_by) VALUES (?, 2, ?, NULL, NULL, NULL)',
    ).run(matchId, nameOf(options.to));

    db.prepare(
      "INSERT INTO match_participants (match_id, user_id, side_index, invitation_status, responded_at) VALUES (?, ?, 1, 'accepted', ?)",
    ).run(matchId, options.from, createdAt);
    db.prepare(
      "INSERT INTO match_participants (match_id, user_id, side_index, invitation_status, responded_at) VALUES (?, ?, 2, 'pending', NULL)",
    ).run(matchId, options.to);

    return matchId;
  } finally {
    db.close();
  }
}

/** The total a player's ledger sums to — the same figure the UI must show. */
export function pointTotal(userId: string): number {
  const db = open();
  try {
    const row = db
      .prepare('SELECT COALESCE(SUM(points), 0) AS total FROM point_events WHERE user_id = ?')
      .get(userId) as { total: number };
    return row.total;
  } finally {
    db.close();
  }
}

export function matchStatus(matchId: string): string {
  const db = open();
  try {
    const row = db.prepare('SELECT status FROM matches WHERE id = ?').get(matchId) as
      | { status: string }
      | undefined;
    return row?.status ?? 'missing';
  } finally {
    db.close();
  }
}

export function pointEventTypes(userId: string): string[] {
  const db = open();
  try {
    return (
      db
        .prepare('SELECT type FROM point_events WHERE user_id = ? ORDER BY created_at, type')
        .all(userId) as { type: string }[]
    ).map((r) => r.type);
  } finally {
    db.close();
  }
}
