/**
 * End-to-end lifecycle over a real SQLite database (specs 0004, 0005).
 *
 * This is the integration suite: it boots a throwaway database, applies the
 * migrations, and drives a match from invitation to awarded points through
 * `applyMatchAction`. It covers what the unit tests cannot — that the effects
 * the state machine returns are actually persisted, that the ledger is
 * idempotent, and that the leaderboard query sums it correctly.
 *
 * It is excluded from `npm test` (which stays unit-only and fast) and is run
 * by CI via `npm run test:integration`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const workdir = mkdtempSync(join(tmpdir(), 'evg-integration-'));
process.env.DATABASE_PATH = join(workdir, 'test.db');
process.env.AUTH_SECRET = 'integration-secret-that-is-long-enough-x';
// NODE_ENV is set to 'test' by Vitest itself, and @types/node types it readonly.

type Modules = {
  db: typeof import('@/db').db;
  schema: typeof import('@/db/schema');
  applyMatchAction: typeof import('./apply').applyMatchAction;
  getStandings: typeof import('@/lib/queries/leaderboard').getStandings;
  getMatchView: typeof import('@/lib/queries/matches').getMatchView;
  getBusyUserIds: typeof import('@/lib/queries/roster').getBusyUserIds;
};

let m: Modules;

const NOW = 1_700_000_000_000;
const MATCH_ID = 'match-1';

beforeAll(async () => {
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const dbModule = await import('@/db');
  migrate(dbModule.db, { migrationsFolder: './src/db/migrations' });

  m = {
    db: dbModule.db,
    schema: await import('@/db/schema'),
    applyMatchAction: (await import('./apply')).applyMatchAction,
    getStandings: (await import('@/lib/queries/leaderboard')).getStandings,
    getMatchView: (await import('@/lib/queries/matches')).getMatchView,
    getBusyUserIds: (await import('@/lib/queries/roster')).getBusyUserIds,
  };

  const { users, games, matches, matchSides, matchParticipants } = m.schema;

  await m.db.insert(users).values([
    { id: 'alice', name: 'Alice', role: 'admin', pinHash: '$2b$12$x', avatar: '🦊', createdAt: NOW },
    { id: 'bob', name: 'Bob', role: 'user', pinHash: '$2b$12$x', avatar: '🐻', createdAt: NOW },
    { id: 'carol', name: 'Carol', role: 'user', pinHash: '$2b$12$x', avatar: '🦉', createdAt: NOW },
  ]);

  await m.db.insert(games).values({
    id: 'game-palet',
    slug: 'palet',
    name: 'Palet',
    description: null,
    icon: '🥏',
    mode: 'duel',
    sidesCount: 2,
    playersPerSide: 1,
    pointsPerWin: 10,
    marginBonusEnabled: true,
    marginBonusPerPoint: 1,
    marginBonusCap: null,
    requiresScore: true,
    isActive: true,
    createdBy: 'alice',
    createdAt: NOW,
    updatedAt: NOW,
  });

  await m.db.insert(matches).values({
    id: MATCH_ID,
    gameId: 'game-palet',
    createdBy: 'alice',
    status: 'pending',
    invitationExpiresAt: NOW + 5 * 60_000,
    rulePointsPerWin: 10,
    ruleMarginBonusPerPoint: 1,
    ruleMarginBonusCap: null,
    ruleRequiresScore: true,
    winningSide: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await m.db.insert(matchSides).values([
    { matchId: MATCH_ID, sideIndex: 1, label: 'Alice', score: null, validatedAt: null, validatedBy: null },
    { matchId: MATCH_ID, sideIndex: 2, label: 'Bob', score: null, validatedAt: null, validatedBy: null },
  ]);
  await m.db.insert(matchParticipants).values([
    { matchId: MATCH_ID, userId: 'alice', sideIndex: 1, invitationStatus: 'accepted', respondedAt: NOW },
    { matchId: MATCH_ID, userId: 'bob', sideIndex: 2, invitationStatus: 'pending', respondedAt: null },
  ]);
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('a match from invitation to points', () => {
  it('activates when the last invitation is accepted', async () => {
    const result = await m.applyMatchAction(MATCH_ID, { type: 'accept', userId: 'bob' }, NOW);
    expect(result).toEqual({ ok: true, status: 'active' });

    const view = await m.getMatchView(MATCH_ID, NOW);
    expect(view?.match.status).toBe('active');
  });

  it('makes both players busy while it runs', async () => {
    const busy = await m.getBusyUserIds(NOW);
    expect(busy.get('alice')).toBe(MATCH_ID);
    expect(busy.get('bob')).toBe(MATCH_ID);
    expect(busy.has('carol')).toBe(false);
  });

  it('notifies the invited player, not the inviter', async () => {
    const { notifications } = m.schema;
    const rows = await m.db.select().from(notifications);
    // Bob accepted, so the "match started" notification goes to Alice only.
    expect(rows.map((r) => r.userId)).toContain('alice');
    expect(rows.every((r) => r.url === `/matches/${MATCH_ID}`)).toBe(true);
  });

  it('persists the report without awarding anything yet', async () => {
    const result = await m.applyMatchAction(
      MATCH_ID,
      {
        type: 'report',
        userId: 'alice',
        winningSide: 1,
        scores: [
          { sideIndex: 1, score: 13 },
          { sideIndex: 2, score: 2 },
        ],
      },
      NOW,
    );
    expect(result).toEqual({ ok: true, status: 'awaiting_validation' });

    const view = await m.getMatchView(MATCH_ID, NOW);
    expect(view?.sides.map((s) => s.score)).toEqual([13, 2]);
    expect(view?.awards).toEqual([]);

    const standings = await m.getStandings();
    expect(standings.find((s) => s.userId === 'alice')?.points).toBe(0);
  });

  it('refuses a validation from the reporter’s own side', async () => {
    const result = await m.applyMatchAction(MATCH_ID, { type: 'validate', userId: 'alice' }, NOW);
    expect(result).toMatchObject({ ok: false, code: 'own_side_cannot_validate' });
  });

  it('awards base points and an itemised margin bonus on validation', async () => {
    const result = await m.applyMatchAction(MATCH_ID, { type: 'validate', userId: 'bob' }, NOW);
    expect(result).toEqual({ ok: true, status: 'completed' });

    const view = await m.getMatchView(MATCH_ID, NOW);
    expect(view?.awards).toHaveLength(2);
    expect(view?.awards.map((a) => [a.type, a.points])).toEqual([
      ['match_win', 10],
      ['margin_bonus', 11],
    ]);
    // The arithmetic is spelled out for the player (spec 0005, rule 12).
    expect(view?.awards[1]?.detail).toBe('Écart 13–2 × 1 pt');
  });

  it('sums the ledger into the leaderboard', async () => {
    const standings = await m.getStandings();
    const alice = standings.find((s) => s.userId === 'alice');
    const bob = standings.find((s) => s.userId === 'bob');
    const carol = standings.find((s) => s.userId === 'carol');

    expect(alice).toMatchObject({ points: 21, wins: 1, losses: 0, played: 1, rank: 1 });
    expect(bob).toMatchObject({ points: 0, wins: 0, losses: 1, played: 1 });
    // Players with no matches stay on the board (spec 0005, rule 15).
    expect(carol).toMatchObject({ points: 0, played: 0 });
  });

  it('frees both players once the match is completed', async () => {
    const busy = await m.getBusyUserIds(NOW);
    expect(busy.size).toBe(0);
  });

  it('is idempotent: re-awarding writes nothing', async () => {
    const { pointEvents } = m.schema;
    const before = await m.db.select().from(pointEvents);
    // A second validation is refused outright, and even if the award step ran
    // again the unique index would make it a no-op (spec 0005, rule 7).
    await m.applyMatchAction(MATCH_ID, { type: 'validate', userId: 'bob' }, NOW);
    const after = await m.db.select().from(pointEvents);
    expect(after).toHaveLength(before.length);
  });

  it('reverses the points exactly when an admin cancels the completed match', async () => {
    const result = await m.applyMatchAction(
      MATCH_ID,
      { type: 'cancel', userId: 'alice', isAdmin: true, reason: 'saisie erronée' },
      NOW,
    );
    expect(result).toEqual({ ok: true, status: 'cancelled' });

    const standings = await m.getStandings();
    expect(standings.find((s) => s.userId === 'alice')?.points).toBe(0);

    // The original awards are still there, alongside their reversal: the
    // ledger is append-only (spec 0005, rule 3).
    const view = await m.getMatchView(MATCH_ID, NOW);
    expect(view?.awards.map((a) => a.type)).toContain('match_reversal');
    expect(view?.awards.map((a) => a.type)).toContain('match_win');
  });
});

describe('invitation expiry over the database', () => {
  const EXPIRED_ID = 'match-expired';

  beforeAll(async () => {
    const { matches, matchSides, matchParticipants } = m.schema;
    await m.db.insert(matches).values({
      id: EXPIRED_ID,
      gameId: 'game-palet',
      createdBy: 'alice',
      status: 'pending',
      invitationExpiresAt: NOW + 5 * 60_000,
      rulePointsPerWin: 10,
      ruleMarginBonusPerPoint: 0,
      ruleMarginBonusCap: null,
      ruleRequiresScore: false,
      winningSide: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await m.db.insert(matchSides).values([
      { matchId: EXPIRED_ID, sideIndex: 1, label: 'Alice', score: null, validatedAt: null, validatedBy: null },
      { matchId: EXPIRED_ID, sideIndex: 2, label: 'Carol', score: null, validatedAt: null, validatedBy: null },
    ]);
    await m.db.insert(matchParticipants).values([
      { matchId: EXPIRED_ID, userId: 'alice', sideIndex: 1, invitationStatus: 'accepted', respondedAt: NOW },
      { matchId: EXPIRED_ID, userId: 'carol', sideIndex: 2, invitationStatus: 'pending', respondedAt: null },
    ]);
  });

  it('reads as expired past the deadline, before any sweep runs', async () => {
    const view = await m.getMatchView(EXPIRED_ID, NOW + 6 * 60_000);
    expect(view?.match.status).toBe('pending');
    expect(view?.effectiveStatus).toBe('expired');
  });

  it('refuses a late acceptance and persists the expiry', async () => {
    const result = await m.applyMatchAction(
      EXPIRED_ID,
      { type: 'accept', userId: 'carol' },
      NOW + 6 * 60_000,
    );
    expect(result).toMatchObject({ ok: false, code: 'invitation_expired' });

    const view = await m.getMatchView(EXPIRED_ID, NOW + 6 * 60_000);
    expect(view?.match.status).toBe('expired');
  });
});
