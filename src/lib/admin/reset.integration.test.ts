import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const workdir = mkdtempSync(join(tmpdir(), 'evg-reset-'));
process.env.DATABASE_PATH = join(workdir, 'test.db');
process.env.AUTH_SECRET = 'integration-secret-that-is-long-enough-x';

type Modules = {
  db: typeof import('@/db').db;
  schema: typeof import('@/db/schema');
  performTournamentReset: typeof import('./reset').performTournamentReset;
};

let m: Modules;

const NOW = 1_700_000_000_000;
const JULIEN = 'team-julien';
const PIERRE = 'team-pierre';
const HASH = '$2b$12$x';

function player(id: string, teamId: string | null, role: 'admin' | 'user' = 'user') {
  return {
    id,
    name: id[0]?.toUpperCase() + id.slice(1),
    role,
    pinHash: HASH,
    avatar: '🐻',
    teamId,
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
    performTournamentReset: (await import('./reset')).performTournamentReset,
  };

  const { users, teams, games } = m.schema;

  await m.db.insert(users).values([
    player('alice', JULIEN, 'admin'),
    player('bob', PIERRE, 'admin'),
    player('carol', JULIEN),
    player('dave', PIERRE),
    player('erin', null),
  ]);

  await m.db.update(teams).set({ captainId: 'alice' }).where(eq(teams.id, JULIEN));
  await m.db.update(teams).set({ captainId: 'bob' }).where(eq(teams.id, PIERRE));

  await m.db.insert(games).values({
    id: 'game-1',
    slug: 'palet',
    name: 'Palet',
    icon: '🎯',
    mode: 'duel',
    sidesCount: 2,
    playersPerSide: 1,
    pointsPerWin: 10,
    createdBy: 'alice',
    createdAt: NOW,
    updatedAt: NOW,
  });
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('Tournament reset', () => {
  it('clears matches, points, notifications, and non-captain teams while preserving captains', async () => {
    const {
      matches,
      matchSides,
      matchParticipants,
      pointEvents,
      teamPointEvents,
      notifications,
      users,
    } = m.schema;

    // Seed active/completed match data
    const matchId = 'match-1';
    await m.db.insert(matches).values({
      id: matchId,
      gameId: 'game-1',
      createdBy: 'alice',
      status: 'completed',
      invitationExpiresAt: NOW + 300_000,
      rulePointsPerWin: 10,
      ruleRequiresScore: false,
      winningSide: 1,
      settledAt: NOW,
      settledBy: 'alice',
      createdAt: NOW,
      updatedAt: NOW,
    });

    await m.db.insert(matchSides).values([
      { matchId, sideIndex: 1, label: 'Alice', score: 13 },
      { matchId, sideIndex: 2, label: 'Bob', score: 11 },
    ]);

    await m.db.insert(matchParticipants).values([
      { matchId, userId: 'alice', sideIndex: 1, invitationStatus: 'accepted' },
      { matchId, userId: 'bob', sideIndex: 2, invitationStatus: 'accepted' },
    ]);

    await m.db.insert(pointEvents).values({
      id: 'pe-1',
      userId: 'alice',
      matchId,
      type: 'match_win',
      points: 10,
      detail: 'Victoire',
      createdBy: 'alice',
      createdAt: NOW,
    });

    await m.db.insert(pointEvents).values({
      id: 'pe-theft-1',
      userId: 'carol',
      matchId: null,
      type: 'scarf_theft',
      points: 2,
      detail: 'Vol de foulard (+2 pts)',
      createdBy: 'alice',
      createdAt: NOW,
    });

    await m.db.insert(teamPointEvents).values({
      id: 'tpe-1',
      teamId: JULIEN,
      matchId,
      type: 'match_win',
      points: 10,
      detail: 'Victoire d’équipe',
      createdBy: 'alice',
      createdAt: NOW,
    });

    await m.db.insert(notifications).values({
      id: 'notif-1',
      userId: 'bob',
      type: 'match_finished',
      title: 'Partie terminée',
      body: 'Alice a gagné',
      url: `/matches/${matchId}`,
      matchId,
      createdAt: NOW,
    });

    // Execute reset
    m.performTournamentReset(m.db);

    // Verify volatile tables are empty
    expect(await m.db.select().from(matches)).toHaveLength(0);
    expect(await m.db.select().from(matchSides)).toHaveLength(0);
    expect(await m.db.select().from(matchParticipants)).toHaveLength(0);
    expect(await m.db.select().from(pointEvents)).toHaveLength(0);
    expect(await m.db.select().from(teamPointEvents)).toHaveLength(0);
    expect(await m.db.select().from(notifications)).toHaveLength(0);

    // Verify captains kept their teams
    const allUsers = await m.db.select().from(users);
    const alice = allUsers.find((u) => u.id === 'alice');
    const bob = allUsers.find((u) => u.id === 'bob');
    const carol = allUsers.find((u) => u.id === 'carol');
    const dave = allUsers.find((u) => u.id === 'dave');
    const erin = allUsers.find((u) => u.id === 'erin');

    expect(alice?.teamId).toBe(JULIEN);
    expect(bob?.teamId).toBe(PIERRE);

    // Non-captains have no team
    expect(carol?.teamId).toBeNull();
    expect(dave?.teamId).toBeNull();
    expect(erin?.teamId).toBeNull();
  });
});
