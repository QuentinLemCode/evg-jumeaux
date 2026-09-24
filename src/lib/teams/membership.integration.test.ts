/**
 * The team transaction and the team ledger, over a real SQLite database
 * (spec 0017).
 *
 * The integration suite, for the same reason as `matches/apply`: what is
 * being proved here is that counting and writing happen in ONE transaction,
 * and that the ledger rows actually land. A pure test cannot prove either —
 * `domain/teams.test.ts` covers the arithmetic those two depend on.
 *
 * Excluded from `npm test`; run by CI via `npm run test:integration`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const workdir = mkdtempSync(join(tmpdir(), 'evg-teams-'));
process.env.DATABASE_PATH = join(workdir, 'test.db');
process.env.AUTH_SECRET = 'integration-secret-that-is-long-enough-x';

type Modules = {
  db: typeof import('@/db').db;
  schema: typeof import('@/db/schema');
  chooseTeam: typeof import('./membership').chooseTeam;
  movePlayerToTeam: typeof import('./membership').movePlayerToTeam;
  applyMatchAction: typeof import('@/lib/matches/apply').applyMatchAction;
  getTeamStandings: typeof import('@/lib/queries/teams').getTeamStandings;
  getStandings: typeof import('@/lib/queries/leaderboard').getStandings;
  listAdminLog: typeof import('@/lib/queries/admin-log').listAdminLog;
};

let m: Modules;

const NOW = 1_700_000_000_000;
const JULIEN = 'team-julien';
const PIERRE = 'team-pierre';

/** Everybody shares this; the PIN never matters here. */
const HASH = '$2b$12$x';

function player(id: string, teamId: string | null) {
  return {
    id,
    name: id[0]?.toUpperCase() + id.slice(1),
    role: 'user' as const,
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
    chooseTeam: (await import('./membership')).chooseTeam,
    movePlayerToTeam: (await import('./membership')).movePlayerToTeam,
    applyMatchAction: (await import('@/lib/matches/apply')).applyMatchAction,
    getTeamStandings: (await import('@/lib/queries/teams')).getTeamStandings,
    getStandings: (await import('@/lib/queries/leaderboard')).getStandings,
    listAdminLog: (await import('@/lib/queries/admin-log')).listAdminLog,
  };

  const { users, teams, games } = m.schema;

  // The two teams come from the MIGRATION, with a null captain, against an
  // empty `users` table — which is the point of doing it there (rule 7).
  const seeded = await m.db.select().from(teams);
  expect(seeded.map((team) => team.id).sort()).toEqual([JULIEN, PIERRE]);
  expect(seeded.every((team) => team.captainId === null)).toBe(true);

  await m.db.insert(users).values([
    { ...player('alice', JULIEN), role: 'admin' as const },
    player('bob', PIERRE),
    // Level pegging, one captain each, and two players who have not chosen.
    player('carol', null),
    player('dave', null),
    player('erin', null),
  ]);

  // The seeder names the captains once the players exist.
  await m.db.update(teams).set({ captainId: 'alice' }).where(eq(teams.id, JULIEN));
  await m.db.update(teams).set({ captainId: 'bob' }).where(eq(teams.id, PIERRE));

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
    marginBonusEnabled: false,
    marginBonusPerPoint: 0,
    marginBonusCap: null,
    requiresScore: false,
    isActive: true,
    createdBy: 'alice',
    createdAt: NOW,
    updatedAt: NOW,
  });
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('choosing a team', () => {
  /**
   * The criterion the spec insists is asserted against the TRANSACTION and
   * not in a browser: two choices made from level pegging leave the teams one
   * apart, never two. The second one reads the count the first one wrote,
   * because reading and writing are the same transaction.
   */
  it('leaves the teams one apart when two players choose while level', () => {
    expect(m.chooseTeam('carol', JULIEN)).toEqual({ ok: true });
    // Dave aims at the same team, which is now a player ahead.
    expect(m.chooseTeam('dave', JULIEN)).toEqual({
      ok: false,
      message: 'Quelqu’un vient de rejoindre cette équipe. Prends l’autre.',
    });
    expect(m.chooseTeam('dave', PIERRE)).toEqual({ ok: true });
  });

  it('refuses a second choice from the same player', () => {
    const result = m.chooseTeam('carol', PIERRE);
    expect(result.ok).toBe(false);
  });

  it('writes no team_moves row for a player choosing for themselves', async () => {
    const rows = await m.db.select().from(m.schema.teamMoves);
    expect(rows).toHaveLength(0);
  });
});

describe('an admin moving a player', () => {
  it('records the move, both teams and the reason', async () => {
    expect(
      m.movePlayerToTeam({
        userId: 'carol',
        teamId: PIERRE,
        reason: 'Arrivée samedi, équipe en sous-effectif',
        movedBy: 'alice',
        now: NOW + 1,
      }),
    ).toEqual({ ok: true });

    const rows = await m.db.select().from(m.schema.teamMoves);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'carol',
      fromTeamId: JULIEN,
      toTeamId: PIERRE,
      movedBy: 'alice',
    });
  });

  it('may leave the teams two apart, where a choice may not', async () => {
    // Julien: alice. Pierre: bob, dave, carol. Moving Erin makes it 1 v 4.
    expect(
      m.movePlayerToTeam({
        userId: 'erin',
        teamId: PIERRE,
        reason: 'Joue avec ses potes',
        movedBy: 'alice',
        now: NOW + 2,
      }),
    ).toEqual({ ok: true });

    const standings = await m.getTeamStandings();
    const pierre = standings.find((team) => team.teamId === PIERRE);
    expect(pierre?.playerCount).toBe(4);
  });

  it('refuses to move a captain', () => {
    const result = m.movePlayerToTeam({
      userId: 'bob',
      teamId: JULIEN,
      reason: 'Pour voir',
      movedBy: 'alice',
      now: NOW + 3,
    });
    expect(result).toEqual({ ok: false, message: 'Un capitaine ne quitte pas son équipe' });
  });

  it('moves no point, and both moves show in the admin log with a delta of 0', async () => {
    const points = await m.db.select().from(m.schema.pointEvents);
    expect(points).toHaveLength(0);

    const entries = await m.listAdminLog('team_move');
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.points === 0)).toBe(true);
  });

  it('shows two successive moves of the same player', async () => {
    m.movePlayerToTeam({
      userId: 'carol',
      teamId: JULIEN,
      reason: 'Retour chez les siens',
      movedBy: 'alice',
      now: NOW + 4,
    });
    const entries = await m.listAdminLog('team_move');
    expect(entries.filter((entry) => entry.targetUserId === 'carol')).toHaveLength(2);
  });
});

describe('what a match pays a team', () => {
  async function playMatch(options: {
    id: string;
    left: string;
    right: string;
    at: number;
  }): Promise<void> {
    const { matches, matchSides, matchParticipants } = m.schema;
    await m.db.insert(matches).values({
      id: options.id,
      gameId: 'game-palet',
      createdBy: options.left,
      status: 'active',
      invitationExpiresAt: options.at + 5 * 60_000,
      rulePointsPerWin: 10,
      ruleMarginBonusPerPoint: 0,
      ruleMarginBonusCap: null,
      ruleRequiresScore: false,
      winningSide: null,
      createdAt: options.at,
      updatedAt: options.at,
    });
    await m.db.insert(matchSides).values([
      { matchId: options.id, sideIndex: 1, label: 'A', score: null, validatedAt: null, validatedBy: null },
      { matchId: options.id, sideIndex: 2, label: 'B', score: null, validatedAt: null, validatedBy: null },
    ]);
    await m.db.insert(matchParticipants).values([
      { matchId: options.id, userId: options.left, sideIndex: 1, invitationStatus: 'accepted', respondedAt: options.at },
      { matchId: options.id, userId: options.right, sideIndex: 2, invitationStatus: 'accepted', respondedAt: options.at },
    ]);

    await m.applyMatchAction(
      options.id,
      { type: 'report', userId: options.left, winningSide: 1, scores: [] },
      options.at,
    );
    await m.applyMatchAction(
      options.id,
      { type: 'validate', userId: options.right },
      options.at,
    );
  }

  it('pays the winning team once, and the winner in full', async () => {
    // Carol is back on Julien; Bob captains Pierre.
    await playMatch({ id: 'match-across', left: 'carol', right: 'bob', at: NOW + 10 });

    const standings = await m.getTeamStandings();
    expect(standings.find((team) => team.teamId === JULIEN)?.points).toBe(10);
    expect(standings.find((team) => team.teamId === PIERRE)?.points).toBe(0);

    const players = await m.getStandings();
    expect(players.find((row) => row.userId === 'carol')?.points).toBe(10);
  });

  it('counts it as a win for that team', async () => {
    const standings = await m.getTeamStandings();
    expect(standings.find((team) => team.teamId === JULIEN)?.matchesWon).toBe(1);
  });

  it('writes one row per (match, team, type), however often it is awarded', async () => {
    // Awarding twice is what a retry or a double submission looks like. The
    // unique index is the guarantee, not the caller's care (rule 21) — this
    // is the same insert `applyEffects` performs, run a second time.
    await m.db
      .insert(m.schema.teamPointEvents)
      .values({
        id: crypto.randomUUID(),
        teamId: JULIEN,
        matchId: 'match-across',
        type: 'match_win',
        points: 10,
        detail: 'Victoire — Palet',
        createdBy: null,
        createdAt: NOW + 11,
      })
      .onConflictDoNothing();

    const rows = await m.db.select().from(m.schema.teamPointEvents);
    expect(rows.filter((row) => row.matchId === 'match-across')).toHaveLength(1);

    const standings = await m.getTeamStandings();
    expect(standings.find((team) => team.teamId === JULIEN)?.points).toBe(10);
  });

  it('pays no team when the two players share one', async () => {
    await playMatch({ id: 'match-inside', left: 'bob', right: 'dave', at: NOW + 20 });

    const rows = await m.db.select().from(m.schema.teamPointEvents);
    expect(rows.some((row) => row.matchId === 'match-inside')).toBe(false);

    const players = await m.getStandings();
    expect(players.find((row) => row.userId === 'bob')?.points).toBe(10);
  });

  it('reverses the award exactly when an admin cancels the match', async () => {
    await m.applyMatchAction(
      'match-across',
      { type: 'cancel', userId: 'alice', isAdmin: true, reason: 'Manche rejouée' },
      NOW + 30,
    );

    const rows = await m.db
      .select()
      .from(m.schema.teamPointEvents);
    const forMatch = rows.filter((row) => row.matchId === 'match-across');
    // Both rows stay: the history shows the award and its reversal (rule 22).
    expect(forMatch).toHaveLength(2);
    expect(forMatch.reduce((sum, row) => sum + row.points, 0)).toBe(0);

    const standings = await m.getTeamStandings();
    const julien = standings.find((team) => team.teamId === JULIEN);
    expect(julien?.points).toBe(0);
    // And the win goes with the points (rule 28).
    expect(julien?.matchesWon).toBe(0);
  });
});
