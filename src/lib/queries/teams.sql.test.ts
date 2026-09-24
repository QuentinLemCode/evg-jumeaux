/**
 * The SQL the team-size query actually generates (spec 0017, rules 11-13).
 *
 * This file exists because of a bug that 25 passing unit tests could not see.
 * `canJoinTeam` was right; the count it was given was always 0, so the two
 * teams always looked level and the balance rule never refused a thing. The
 * cause was one unqualified identifier in a hand-written fragment, and it
 * took a full CI round trip — a database, a browser and four red tests — to
 * find something a string assertion catches in milliseconds.
 *
 * No database: Drizzle's standalone `QueryBuilder` renders SQL without a
 * connection, so this belongs in the fast unit suite (`npm test`) rather than
 * in the integration one.
 */
import { asc, sql } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import { teams, users } from '@/db/schema';

import { TEAM_MEMBERSHIP_JOIN, TEAM_SIZE_FIELDS } from './teams';

/** The same shape `teamSizeQuery()` builds, on a runner that needs no file. */
function renderTeamSizeQuery(): string {
  return new QueryBuilder()
    .select(TEAM_SIZE_FIELDS)
    .from(teams)
    .leftJoin(users, TEAM_MEMBERSHIP_JOIN)
    .groupBy(teams.id)
    .orderBy(asc(teams.name))
    .toSQL()
    .sql;
}

describe('the team-size query', () => {
  it('ties a player to their own team, with both sides qualified', () => {
    expect(renderTeamSizeQuery()).toContain(
      'left join "users" on "users"."team_id" = "teams"."id"',
    );
  });

  it('counts a column, so a team nobody joined reports 0 and not 1', () => {
    // `count(*)` over a LEFT JOIN counts the all-null row an empty team
    // produces. `count("users"."id")` does not.
    expect(renderTeamSizeQuery()).toContain('count("users"."id")');
    expect(renderTeamSizeQuery()).not.toContain('count(*)');
  });

  it('counts by joining and never by a nested select', () => {
    // The fault itself. A correlated subquery is where an unqualified
    // identifier becomes dangerous: another table comes into scope inside it,
    // and the bare name binds to the innermost one. There is no nested select
    // in this query, so there is nowhere for that to happen.
    expect(renderTeamSizeQuery()).not.toMatch(/\(\s*select/i);
  });

  it('leaves no bare identifier that could bind to the wrong table', () => {
    // `= "id"` or `= "team_id"` with no table in front. Drizzle qualifies
    // every identifier as soon as a query has a join — this is what says the
    // join is still there.
    expect(renderTeamSizeQuery()).not.toMatch(/=\s*"(id|team_id)"/);
  });

  /**
   * What the code used to say, kept as the counter-example: a reader should
   * be able to see WHY the join is not a style preference. Drizzle renders a
   * single-table select unqualified, so this reads `where "team_id" = "id"` —
   * and inside the subquery `users` is in scope, so both bind to `users`. It
   * counts the players whose team is their own id: nobody, always.
   */
  it('proves the guard would have caught the subquery it replaced', () => {
    const broken = new QueryBuilder()
      .select({
        teamId: teams.id,
        memberCount: sql<number>`(
          select count(*) from ${users} where ${users.teamId} = ${teams.id}
        )`,
      })
      .from(teams)
      .toSQL().sql;

    expect(broken).toMatch(/=\s*"id"/);
    expect(broken).not.toContain('"teams"."id"');
  });
});
