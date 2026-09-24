import { expect, test, type Browser, type Page } from '@playwright/test';

import { PLAYERS, login } from './helpers/auth';
import { pointTotal, resetVolatileState } from './helpers/db';

/**
 * The public admin log (spec 0008, rules 15-21).
 *
 * The feature exists for the people whose scores moved, not for the admins —
 * so the tests that matter are "a plain player can read it" and "the reason is
 * there in full".
 */
async function asPlayer(browser: Browser, player: keyof typeof PLAYERS): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, player);
  return page;
}

test.beforeEach(() => resetVolatileState());

test.describe('The admin log', { tag: ['@spec-0008', '@spec-0007'] }, () => {
  test('it is empty and says so when no admin has touched anything', async ({ browser }) => {
    const player = await asPlayer(browser, 'antoine');
    await player.goto('/admin-log');
    await expect(player.getByText('Aucune intervention')).toBeVisible();
    await expect(player.getByText('C’est bon signe.')).toBeVisible();
  });

  test('it is reached from the history, by anyone', async ({ browser }) => {
    // Spec 0007, rule 0: two public views of the same screen.
    const player = await asPlayer(browser, 'hugo');
    await player.goto('/history');
    await expect(player.getByRole('heading', { name: 'Historique' })).toBeVisible();

    await player.getByRole('link', { name: 'Journal' }).click();
    await expect(player.getByRole('heading', { name: 'Journal des admins' })).toBeVisible();

    await player.getByRole('link', { name: 'Parties' }).click();
    await expect(player.getByRole('heading', { name: 'Historique' })).toBeVisible();
  });

  test('an adjustment appears with its author, its reason and its delta', async ({
    browser,
  }) => {
    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin');
    await admin.getByLabel('Joueur', { exact: true }).selectOption(PLAYERS.lucas.id);
    await admin.getByPlaceholder('ex. 25 ou -10').fill('30');
    await admin
      .getByPlaceholder('ex. Vainqueur du concours de grimaces')
      .fill('Champion du lancer de tong');
    await admin.getByRole('button', { name: 'Ajuster les points' }).click();
    await expect(admin.getByText('Ajustement enregistré.')).toBeVisible();
    expect(pointTotal(PLAYERS.lucas.id)).toBe(30);

    // A player with no admin rights reads the whole thing. Not Thomas: he is
    // the one guest with no team, and the gate would send him to the choice
    // screen before he ever saw the log (spec 0017, rule 10).
    const player = await asPlayer(browser, 'romain');
    await player.goto('/admin-log');

    const entry = player.getByTestId('admin-log-entry').first();
    await expect(entry).toHaveAttribute('data-kind', 'adjustment');
    await expect(entry).toContainText('Points ajustés');
    await expect(entry).toContainText(PLAYERS.quentin.name);
    await expect(entry).toContainText(PLAYERS.lucas.name);
    // In full, never folded behind a "show more" (spec 0008, rule 18).
    await expect(entry).toContainText('Champion du lancer de tong');
    await expect(entry).toContainText('+30');
  });

  test('filtering by type narrows it, and the default shows everything', async ({
    browser,
  }) => {
    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin');
    await admin.getByLabel('Joueur', { exact: true }).selectOption(PLAYERS.clement.id);
    await admin.getByPlaceholder('ex. 25 ou -10').fill('15');
    await admin
      .getByPlaceholder('ex. Vainqueur du concours de grimaces')
      .fill('Arbitrage du concours de grimaces');
    await admin.getByRole('button', { name: 'Ajuster les points' }).click();
    await expect(admin.getByText('Ajustement enregistré.')).toBeVisible();

    const player = await asPlayer(browser, 'antoine');
    await player.goto('/admin-log');
    await expect(player.getByTestId('admin-log-entry')).toHaveCount(1);

    await player.getByRole('link', { name: 'Points ajustés' }).click();
    await expect(player.getByTestId('admin-log-entry')).toHaveCount(1);

    await player.getByRole('link', { name: 'Partie annulée' }).click();
    await expect(player.getByTestId('admin-log-entry')).toHaveCount(0);
    await expect(player.getByText('Rien de ce type')).toBeVisible();

    await player.getByRole('link', { name: 'Tout' }).click();
    await expect(player.getByTestId('admin-log-entry')).toHaveCount(1);
  });
});
