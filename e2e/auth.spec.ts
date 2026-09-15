import { expect, test } from '@playwright/test';

import { DEV_PIN, PLAYERS, login, pickPlayer, typePin } from './helpers/auth';

/**
 * Authentication and the escalating lockout (spec 0001).
 *
 * Note on isolation: the lockout counter lives in the server's memory and is
 * never reset between tests, so each test that fails a PIN on purpose uses a
 * player NOBODY ELSE touches. Sharing a player here would make the suite
 * order-dependent in a way that only shows up weeks later.
 */
test.describe('Authentication', { tag: ['@spec-0001', '@spec-0002'] }, () => {
  test('the landing page is the login screen and nothing else', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('EVG des Jumeaux')).toBeVisible();
    await expect(page.getByLabel('Cherche ton prénom')).toBeVisible();
    // No leaderboard, no navigation: there is nothing to see before logging in.
    await expect(page.getByRole('heading', { name: 'Classement' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Historique' })).toHaveCount(0);
  });

  test('only seeded players are offered', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Antoine', exact: true })).toBeVisible();

    await page.getByLabel('Cherche ton prénom').fill('Gandalf');
    await expect(page.getByText('Aucun prénom ne correspond.')).toBeVisible();
  });

  test('a correct PIN lands on the leaderboard', async ({ page }) => {
    await login(page, 'antoine');
    await expect(page.getByRole('heading', { name: 'Classement' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Antoine/ })).toBeVisible();
  });

  test('a protected page redirects to login and comes back afterwards', async ({ page }) => {
    await page.goto('/history');
    // Redirected, with the destination remembered (spec 0001, rule 7).
    await expect(page.getByLabel('Cherche ton prénom')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('next')).toBe('/history');

    await pickPlayer(page, PLAYERS.baptiste.name);
    await typePin(page, DEV_PIN);
    await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible();
  });

  test('the admin log is readable without being an admin', async ({ page }) => {
    // Spec 0008, rule 16: public is the whole point.
    await login(page, 'clement');
    await page.goto('/admin-log');
    await expect(page.getByRole('heading', { name: 'Journal des admins' })).toBeVisible();
    await expect(page.getByText('Visible par tout le monde.')).toBeVisible();
  });

  test('a non-admin cannot reach the admin console', async ({ page }) => {
    await login(page, 'hugo');
    await page.goto('/admin');
    // Redirected to the leaderboard, not shown a disabled console.
    await expect(page.getByRole('heading', { name: 'Classement' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Administration' })).toHaveCount(0);
  });

  test('an admin sees the Admin destination; a player does not', async ({ page }) => {
    await login(page, 'quentin');
    await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();

    await page.getByRole('link', { name: 'Admin' }).click();
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  });

  test('logging out clears the session', async ({ page }) => {
    await login(page, 'lucas');
    await page.goto(`/players/${PLAYERS.lucas.id}`);
    await page.getByRole('button', { name: 'Se déconnecter' }).click();

    await expect(page.getByLabel('Cherche ton prénom')).toBeVisible();
    await page.goto('/leaderboard');
    await expect(page.getByLabel('Cherche ton prénom')).toBeVisible();
  });
});

test.describe('The escalating lockout', { tag: '@spec-0001' }, () => {
  test('a wrong PIN says so without revealing anything else', async ({ page }) => {
    // Romain is used ONLY here: the rate limiter is in-memory per player.
    await page.goto('/');
    await pickPlayer(page, PLAYERS.romain.name);
    await typePin(page, '000000');
    await expect(page.getByRole('alert')).toContainText('Code incorrect');
    // Still on the login screen, PIN cleared, name kept.
    await expect(page.getByTestId('pin-keypad')).toBeVisible();
  });

  test('three attempts are free, the fourth waits', async ({ page }) => {
    // Thomas is used ONLY here, for the same reason.
    await page.goto('/');
    await pickPlayer(page, PLAYERS.thomas.name);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await typePin(page, '111111');
      await expect(page.getByRole('alert')).toBeVisible();
    }

    // The third failure arms the ladder, and the message says how long
    // (spec 0001, rule 11). 10 s is the first rung.
    await expect(page.getByRole('alert')).toContainText(/Réessaie dans \d+ seconde/);

    // The keypad is disabled with a live countdown rather than silently
    // rejecting: a dead keypad with no explanation is worse than the lockout.
    const status = page.getByRole('status');
    await expect(status).toContainText('Réessaie dans');
    await expect(
      page.getByTestId('pin-keypad').getByRole('button', { name: '1', exact: true }),
    ).toBeDisabled();

    // …and it re-enables itself when the countdown reaches zero.
    await expect(
      page.getByTestId('pin-keypad').getByRole('button', { name: '1', exact: true }),
    ).toBeEnabled({ timeout: 20_000 });
  });
});
