import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const workdir = mkdtempSync(join(tmpdir(), 'evg-scarf-'));
process.env.DATABASE_PATH = join(workdir, 'test.db');
process.env.AUTH_SECRET = 'integration-secret-that-is-long-enough-x';

let currentToken: string | null = null;

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      if (name === 'evg_session' && currentToken) {
        return { value: currentToken };
      }
      return undefined;
    },
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

type Modules = {
  db: typeof import('@/db').db;
  schema: typeof import('@/db/schema');
  assignScarfTheft: typeof import('@/lib/actions/admin').assignScarfTheft;
  getStandings: typeof import('@/lib/queries/leaderboard').getStandings;
  listAdminLog: typeof import('@/lib/queries/admin-log').listAdminLog;
  countAdminLog: typeof import('@/lib/queries/admin-log').countAdminLog;
  getPlayerProfile: typeof import('@/lib/queries/players').getPlayerProfile;
  createSessionToken: typeof import('@/lib/auth/session').createSessionToken;
};

let m: Modules;
const NOW = 1_700_000_000_000;
const HASH = '$2b$12$x';

function player(id: string, role: 'admin' | 'user' = 'user') {
  return {
    id,
    name: id[0]?.toUpperCase() + id.slice(1),
    role,
    pinHash: HASH,
    avatar: '🐻',
    teamId: null,
    createdAt: NOW,
  };
}

beforeAll(async () => {
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const dbModule = await import('@/db');
  migrate(dbModule.db, { migrationsFolder: './src/db/migrations' });

  m = {
    db: dbModule.db,
    schema: await import('@/db/schema'),
    assignScarfTheft: (await import('@/lib/actions/admin')).assignScarfTheft,
    getStandings: (await import('@/lib/queries/leaderboard')).getStandings,
    listAdminLog: (await import('@/lib/queries/admin-log')).listAdminLog,
    countAdminLog: (await import('@/lib/queries/admin-log')).countAdminLog,
    getPlayerProfile: (await import('@/lib/queries/players')).getPlayerProfile,
    createSessionToken: (await import('@/lib/auth/session')).createSessionToken,
  };

  const { users } = m.schema;
  await m.db.insert(users).values([
    player('admin1', 'admin'),
    player('alice', 'user'),
    player('bob', 'user'),
  ]);
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('Scarf theft (spec 0018)', () => {
  it('rejects unauthenticated users', async () => {
    currentToken = null;
    const res = await m.assignScarfTheft({ userId: 'alice', points: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toBe('Ta session a expiré, reconnecte-toi');
    }
  });

  it('rejects non-admin users', async () => {
    currentToken = await m.createSessionToken('bob');
    const res = await m.assignScarfTheft({ userId: 'alice', points: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toBe('Réservé aux admins');
    }
  });

  it('validates points and player existence with admin context', async () => {
    currentToken = await m.createSessionToken('admin1');

    // Reject unknown player
    const unknownRes = await m.assignScarfTheft({ userId: 'unknown-player', points: 2 });
    expect(unknownRes.ok).toBe(false);
    if (!unknownRes.ok) {
      expect(unknownRes.message).toBe('Joueur inconnu');
    }

    // Reject 0 points
    const zeroRes = await m.assignScarfTheft({ userId: 'alice', points: 0 });
    expect(zeroRes.ok).toBe(false);
    if (!zeroRes.ok) {
      expect(zeroRes.message).toBe('Indique un nombre de points non nul');
    }

    // Reject out of bounds points (> 1000)
    const highRes = await m.assignScarfTheft({ userId: 'alice', points: 1001 });
    expect(highRes.ok).toBe(false);
    if (!highRes.ok) {
      expect(highRes.message).toBe('Maximum 1000 points');
    }

    // Reject out of bounds points (< -1000)
    const lowRes = await m.assignScarfTheft({ userId: 'alice', points: -1001 });
    expect(lowRes.ok).toBe(false);
    if (!lowRes.ok) {
      expect(lowRes.message).toBe('Maximum 1000 points');
    }

    // Success 1: default 2 points without note
    const success1 = await m.assignScarfTheft({ userId: 'alice', points: 2 });
    expect(success1.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Success 2: 5 points with note
    const success2 = await m.assignScarfTheft({
      userId: 'alice',
      points: 5,
      note: 'Pendant le dessert',
    });
    expect(success2.ok).toBe(true);

    // Verify standings
    const standings = await m.getStandings();
    const aliceStanding = standings.find((s) => s.userId === 'alice');
    expect(aliceStanding?.points).toBe(7);
    expect(aliceStanding?.scarfTheftsCount).toBe(2);
    expect(aliceStanding?.scarfTheftsPoints).toBe(7);

    // Verify admin log
    const logEntries = await m.listAdminLog();
    const theftEntries = logEntries.filter((e) => e.type === 'scarf_theft');
    expect(theftEntries).toHaveLength(2);
    expect(theftEntries[0]?.reason).toBe('Vol de foulard (+5 pts) — Pendant le dessert');
    expect(theftEntries[0]?.points).toBe(5);
    expect(theftEntries[0]?.subject).toBe('Alice');
    expect(theftEntries[0]?.adminName).toBe('Admin1');

    expect(theftEntries[1]?.reason).toBe('Vol de foulard (+2 pts)');
    expect(theftEntries[1]?.points).toBe(2);

    const logCount = await m.countAdminLog();
    expect(logCount).toBe(2);

    // Verify player profile ledger
    const aliceProfile = await m.getPlayerProfile('alice');
    expect(aliceProfile?.standing.scarfTheftsCount).toBe(2);
    expect(aliceProfile?.standing.scarfTheftsPoints).toBe(7);
    expect(aliceProfile?.ledger).toHaveLength(2);
    expect(aliceProfile?.ledger[0]?.type).toBe('scarf_theft');
    expect(aliceProfile?.ledger[0]?.points).toBe(5);
    expect(aliceProfile?.ledger[0]?.detail).toBe('Vol de foulard (+5 pts) — Pendant le dessert');
  });
});
