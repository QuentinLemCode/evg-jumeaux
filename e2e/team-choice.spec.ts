import { expect, test, type Browser, type Page } from '@playwright/test';

import { DEV_PIN, PLAYERS, login, pickPlayer, typePin } from './helpers/auth';
import { clearTeamFor, resetVolatileState, teamSlugOf } from './helpers/db';

/**
 * Choosing a team (spec 0017, rules 11-17).
 *
 * The e2e roster is nine players, so a team is full at five — `ceil(9 / 2)`,
 * the same arithmetic as eight of fifteen. Julien is seeded at exactly five,
 * which is what makes "a full team is disabled and says why" reachable
 * without inventing anybody.
 *
 * What only a browser can show: that the finality is stated BEFORE anything
 * is written and that confirming takes a second deliberate action, that a
 * player swept into a team finds out from their inbox, and that no screen
 * anywhere offers a way to undo any of it.
 */
async function asPlayer(browser: Browser, player: keyof typeof PLAYERS): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, player);
  return page;
}

/** Logs in somebody who has no team, so they land on the choice screen. */
async function atTheChoiceScreen(
  browser: Browser,
  player: keyof typeof PLAYERS,
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await pickPlayer(page, PLAYERS[player].name);
  await typePin(page, DEV_PIN);
  await page.waitForURL(/\/team-choice/);
  return page;
}

test.beforeEach(() => resetVolatileState());

test.describe('Choosing a team', { tag: '@spec-0017' }, () => {
  test('says the choice is final, and takes two actions to make it', async ({
    browser,
  }) => {
    // `resetVolatileState()` leaves `users` alone, so a choice is permanent
    // for the life of the database — without this the test passes once and
    // fails on the CI retry.
    clearTeamFor(PLAYERS.thomas.id);

    const thomas = await atTheChoiceScreen(browser, 'thomas');
    await expect(thomas.getByRole('heading', { name: 'Choisis ton camp' })).toBeVisible();

    // In those words, before anything is confirmed — not fine print (rule 17).
    await expect(thomas.getByText('Ce choix est définitif.')).toBeVisible();

    // Julien is at the cap, so it is offered DISABLED, naming itself and the
    // reason (rule 16) — never silently absent.
    const julien = thomas.locator('[data-team="julien"]');
    const pierre = thomas.locator('[data-team="pierre"]');
    await expect(julien).toBeDisabled();
    await expect(julien).toContainText('est complète');
    await expect(pierre).toBeEnabled();

    // Picking is not joining: nothing is written until the second action.
    await expect(thomas.getByTestId('confirm-team')).toHaveCount(0);
    await pierre.click();
    const confirm = thomas.getByTestId('confirm-team');
    await expect(confirm).toContainText('Équipe Pierre');
    expect(teamSlugOf(PLAYERS.thomas.id)).toBeNull();

    await confirm.click();
    await thomas.waitForURL(/\/leaderboard$/);
    expect(teamSlugOf(PLAYERS.thomas.id)).toBe('pierre');
  });

  test('the choice that fills a team places everybody left, and tells them', async ({
    browser,
  }) => {
    // Julien four of five, and two players still without a team.
    clearTeamFor(PLAYERS.hugo.id);
    clearTeamFor(PLAYERS.thomas.id);

    const hugo = await atTheChoiceScreen(browser, 'hugo');
    await hugo.locator('[data-team="julien"]').click();
    await hugo.getByTestId('confirm-team').click();
    await hugo.waitForURL(/\/leaderboard$/);

    // Hugo's choice filled Julien, so Thomas went to Pierre without ever
    // opening this screen (rule 13).
    expect(teamSlugOf(PLAYERS.hugo.id)).toBe('julien');
    expect(teamSlugOf(PLAYERS.thomas.id)).toBe('pierre');

    // …and he is told which team that is, or he would find out from a
    // leaderboard (rule 15).
    const thomas = await asPlayer(browser, 'thomas');
    await thomas.goto('/notifications');
    await expect(thomas.getByText(/Tu joues dans l’Équipe Pierre/)).toBeVisible();

    // Hugo caused it, so nobody tells Hugo (spec 0006, rule 9).
    await hugo.goto('/notifications');
    await expect(hugo.getByText(/Tu joues dans/)).toHaveCount(0);
  });

  test('offers nobody, not even an admin, a way to move a player', async ({
    browser,
  }) => {
    // Rule 17: there is no move, so there is nothing to record and nothing
    // for the admin log to carry.
    const admin = await asPlayer(browser, 'quentin');

    await admin.goto('/admin');
    await expect(admin.getByRole('heading', { name: 'Administration' })).toBeVisible();
    await expect(admin.getByLabel('Joueur à déplacer')).toHaveCount(0);
    await expect(admin.getByRole('button', { name: 'Déplacer le joueur' })).toHaveCount(0);

    await admin.goto('/admin-log');
    await expect(admin.getByRole('link', { name: 'Joueur déplacé' })).toHaveCount(0);

    // And a player who has chosen is told the door is closed, not offered it.
    await admin.goto('/team-choice');
    await expect(admin.getByTestId('team-option')).toHaveCount(0);
  });
});
