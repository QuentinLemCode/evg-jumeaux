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
  applyMatchAction: typeof import('@/lib/matches/apply').applyMatchAction;
  getTeamStandings: typeof import('@/lib/queries/teams').getTeamStandings;
  getStandings: typeof import('@/lib/queries/leaderboard').getStandings;
  listAdminLog: typeof import('@/lib/queries/admin-log').listAdminLog;
  getBusyUserIds: typeof import('@/lib/queries/roster').getBusyUserIds;
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
    applyMatchAction: (await import('@/lib/matches/apply')).applyMatchAction,
    getTeamStandings: (await import('@/lib/queries/teams')).getTeamStandings,
    getStandings: (await import('@/lib/queries/leaderboard')).getStandings,
    listAdminLog: (await import('@/lib/queries/admin-log')).listAdminLog,
    getBusyUserIds: (await import('@/lib/queries/roster')).getBusyUserIds,
  };

  const { users, teams, games } = m.schema;

  // The two teams come from the MIGRATION, with a null captain, against an
  // empty `users` table — which is the point of doing it there (rule 8).
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

/**
 * Five players, so a team is full at three: `ceil(5 / 2)` (rule 12). The cap
 * is derived, so the fixture does not have to be fifteen people to exercise
 * the rule that matters.
 */
describe('choosing a team', () => {
  it('lets a player join while both teams have room', () => {
    // Julien: alice. Pierre: bob. Nobody is ahead, and below the cap the
    // choice is the player's either way.
    expect(m.chooseTeam('carol', JULIEN)).toEqual({ ok: true, assigned: [] });
  });

  /**
   * Rules 13-14, and the criterion the spec insists is asserted against the
   * TRANSACTION rather than in a browser. Dave's choice is the one that fills
   * Julien, and in the same transaction it places Erin — the only player
   * left — in Pierre. Two players cannot both take that last slot, because
   * the second one reads the count the first one wrote.
   */
  it('places everybody left the moment a choice fills a team', async () => {
    expect(m.chooseTeam('dave', JULIEN)).toEqual({
      ok: true,
      assigned: [{ userId: 'erin', teamId: PIERRE, teamName: 'Équipe Pierre' }],
    });

    // Three, which is the cap — never four.
    const standings = await m.getTeamStandings();
    expect(standings.find((team) => team.teamId === JULIEN)?.playerCount).toBe(3);
    expect(standings.find((team) => team.teamId === PIERRE)?.playerCount).toBe(2);
  });

  it('refuses the player it just placed, because the choice is final', () => {
    // Erin never chose, and still cannot choose now (rule 17).
    expect(m.chooseTeam('erin', JULIEN).ok).toBe(false);
    expect(m.chooseTeam('carol', PIERRE).ok).toBe(false);
  });

  /**
   * A full team is normally unreachable by then — the sweep leaves nobody to
   * face one. It becomes reachable when a guest is added to the roster after
   * the fact, which is exactly when a forged request would find it: the
   * screen would show the button disabled, and the action must refuse it
   * regardless.
   */
  it('refuses a full team even when nothing on screen offered it', async () => {
    await m.db.insert(m.schema.users).values(player('late', null));

    // Six players now, so the cap is still three, and Julien is at it.
    expect(m.chooseTeam('late', JULIEN)).toEqual({
      ok: false,
      message: 'Quelqu’un vient de rejoindre cette équipe. Prends l’autre.',
    });
    expect(m.chooseTeam('late', PIERRE)).toEqual({ ok: true, assigned: [] });
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
    // Carol chose Julien; Bob captains Pierre.
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
    // Bob and Erin are both Pierre: Erin was placed there by the sweep.
    await playMatch({ id: 'match-inside', left: 'bob', right: 'erin', at: NOW + 20 });

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

/**
 * The clash, which runs alongside everything else (spec 0017, rule 6).
 *
 * This needs a database: the busy carve-out is a join to `games`, and no pure
 * function can be wrong about a join that is not there.
 */
describe('a clash', () => {
  const CLASH_ID = 'match-clash';
  const DUEL_ID = 'match-duel-parallel';
  const AT = NOW + 100;

  beforeAll(async () => {
    const { games, matches, matchSides, matchParticipants } = m.schema;

    await m.db.insert(games).values({
      id: 'game-clash',
      slug: 'le-grand-match',
      name: 'Le grand match',
      description: null,
      icon: '🏆',
      mode: 'clash',
      sidesCount: 2,
      playersPerSide: 1,
      pointsPerWin: 25,
      marginBonusEnabled: false,
      marginBonusPerPoint: 0,
      marginBonusCap: null,
      requiresScore: false,
      isActive: true,
      createdBy: 'alice',
      createdAt: AT,
      updatedAt: AT,
    });

    // Julien: alice, carol, dave. Pierre: bob, erin, late. Created the way
    // `createMatch` creates one: active at once and everybody accepted.
    await m.db.insert(matches).values({
      id: CLASH_ID,
      gameId: 'game-clash',
      createdBy: 'alice',
      status: 'active',
      invitationExpiresAt: AT + 5 * 60_000,
      rulePointsPerWin: 25,
      ruleMarginBonusPerPoint: 0,
      ruleMarginBonusCap: null,
      ruleRequiresScore: false,
      winningSide: null,
      createdAt: AT,
      updatedAt: AT,
    });
    await m.db.insert(matchSides).values([
      { matchId: CLASH_ID, sideIndex: 1, label: 'Équipe Julien', score: null, validatedAt: null, validatedBy: null },
      { matchId: CLASH_ID, sideIndex: 2, label: 'Équipe Pierre', score: null, validatedAt: null, validatedBy: null },
    ]);
    await m.db.insert(matchParticipants).values([
      { matchId: CLASH_ID, userId: 'alice', sideIndex: 1, invitationStatus: 'accepted', respondedAt: AT },
      { matchId: CLASH_ID, userId: 'carol', sideIndex: 1, invitationStatus: 'accepted', respondedAt: AT },
      { matchId: CLASH_ID, userId: 'dave', sideIndex: 1, invitationStatus: 'accepted', respondedAt: AT },
      { matchId: CLASH_ID, userId: 'bob', sideIndex: 2, invitationStatus: 'accepted', respondedAt: AT },
      { matchId: CLASH_ID, userId: 'erin', sideIndex: 2, invitationStatus: 'accepted', respondedAt: AT },
      { matchId: CLASH_ID, userId: 'late', sideIndex: 2, invitationStatus: 'accepted', respondedAt: AT },
    ]);
  });

  it('makes nobody busy, so the evening carries on around it', async () => {
    const busy = await m.getBusyUserIds(AT);
    for (const player of ['alice', 'carol', 'dave', 'bob', 'erin', 'late']) {
      expect(busy.has(player), `${player} should be free`).toBe(false);
    }
  });

  it('does not stop an ordinary match running in parallel', async () => {
    const { matches, matchSides, matchParticipants } = m.schema;
    await m.db.insert(matches).values({
      id: DUEL_ID,
      gameId: 'game-palet',
      createdBy: 'carol',
      status: 'active',
      invitationExpiresAt: AT + 5 * 60_000,
      rulePointsPerWin: 10,
      ruleMarginBonusPerPoint: 0,
      ruleMarginBonusCap: null,
      ruleRequiresScore: false,
      winningSide: null,
      createdAt: AT,
      updatedAt: AT,
    });
    await m.db.insert(matchSides).values([
      { matchId: DUEL_ID, sideIndex: 1, label: 'Carol', score: null, validatedAt: null, validatedBy: null },
      { matchId: DUEL_ID, sideIndex: 2, label: 'Dave', score: null, validatedAt: null, validatedBy: null },
    ]);
    await m.db.insert(matchParticipants).values([
      { matchId: DUEL_ID, userId: 'carol', sideIndex: 1, invitationStatus: 'accepted', respondedAt: AT },
      { matchId: DUEL_ID, userId: 'dave', sideIndex: 2, invitationStatus: 'accepted', respondedAt: AT },
    ]);

    // The duel DOES make its two players busy; the clash still makes nobody.
    const busy = await m.getBusyUserIds(AT);
    expect(busy.get('carol')).toBe(DUEL_ID);
    expect(busy.get('dave')).toBe(DUEL_ID);
    expect(busy.has('alice')).toBe(false);
    expect(busy.has('bob')).toBe(false);
    expect(busy.has('erin')).toBe(false);
    expect(busy.has('late')).toBe(false);
  });

  it('pays its winning team once when it settles', async () => {
    await m.applyMatchAction(
      CLASH_ID,
      { type: 'settle-clash', adminId: 'alice', winningSide: 1, scores: [] },
      AT + 2,
    );

    const rows = await m.db.select().from(m.schema.teamPointEvents);
    const forClash = rows.filter((row) => row.matchId === CLASH_ID);
    // Once for the whole side, whatever its size (rule 18).
    expect(forClash).toHaveLength(1);
    expect(forClash[0]).toMatchObject({ teamId: JULIEN, type: 'match_win', points: 25 });
  });

  it('awards no individual points to players for a clash, preserving individual balance', async () => {
    const players = await m.getStandings();
    expect(players.find((row) => row.userId === 'carol')?.points).toBe(0);
    expect(players.find((row) => row.userId === 'alice')?.points).toBe(0);
  });

  it('reflects clash points on team standings and includes admin adjustments in team total', async () => {
    let standings = await m.getTeamStandings();
    const julienBefore = standings.find((team) => team.teamId === JULIEN);
    expect(julienBefore?.clashPoints).toBe(25);
    expect(julienBefore?.individualPoints).toBe(0);
    expect(julienBefore?.points).toBe(25);

    // Admin awards +20 manual adjustment to Alice (who is in Julien)
    await m.db.insert(m.schema.pointEvents).values({
      id: crypto.randomUUID(),
      userId: 'alice',
      matchId: null,
      type: 'admin_adjustment',
      points: 20,
      detail: 'Bonus admin',
      createdBy: 'alice',
      createdAt: AT + 10,
    });

    standings = await m.getTeamStandings();
    const julienAfter = standings.find((team) => team.teamId === JULIEN);
    expect(julienAfter?.clashPoints).toBe(25);
    expect(julienAfter?.individualPoints).toBe(20);
    expect(julienAfter?.points).toBe(45);
  });
});

