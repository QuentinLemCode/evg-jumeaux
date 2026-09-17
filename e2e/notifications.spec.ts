import { expect, test, type Browser, type Page } from '@playwright/test';

import { PLAYERS, login } from './helpers/auth';
import { resetVolatileState } from './helpers/db';

/**
 * The in-app inbox (spec 0006).
 *
 * Push delivery cannot be tested from a headless browser without a real push
 * service, and that is fine: the inbox is the SOURCE OF TRUTH and push is a
 * delivery channel on top (rule 1). So the inbox is what the tests hold to
 * account — including the rule that trips every notification system, "never
 * notify the person who caused it".
 */
async function asPlayer(browser: Browser, player: keyof typeof PLAYERS): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, player);
  return page;
}

test.beforeEach(() => resetVolatileState());

test.describe('Notifications', { tag: '@spec-0006' }, () => {
  test('an invitation notifies the invited player and not the inviter', async ({ browser }) => {
    const antoine = await asPlayer(browser, 'antoine');
    const baptiste = await asPlayer(browser, 'baptiste');

    await antoine.goto('/games');
    await antoine.getByRole('link', { name: /Palet/ }).click();
    await antoine.getByRole('button', { name: new RegExp(`^${PLAYERS.baptiste.name}`) }).click();
    await antoine.getByRole('button', { name: 'Envoyer les invitations' }).click();
    await antoine.waitForURL(/\/matches\/[0-9a-f-]+$/);
    const matchId = antoine.url().split('/matches/')[1] as string;

    // Baptiste is told, with a deep link straight to the match (rule 8).
    await baptiste.goto('/notifications');
    const invitation = baptiste.getByRole('button', { name: /te défie/ });
    await expect(invitation).toBeVisible();
    await expect(invitation).toContainText('5 minutes');
    await invitation.click();
    await expect(baptiste).toHaveURL(new RegExp(`/matches/${matchId}$`));

    // Antoine is not told about his own action (rule 9).
    await antoine.goto('/notifications');
    await expect(antoine.getByText('Aucune alerte')).toBeVisible();
  });

  test('the unread badge counts, and clears when read', async ({ browser }) => {
    const hugo = await asPlayer(browser, 'hugo');
    const lucas = await asPlayer(browser, 'lucas');

    await hugo.goto('/games');
    await hugo.getByRole('link', { name: /Palet/ }).click();
    await hugo.getByRole('button', { name: new RegExp(`^${PLAYERS.lucas.name}`) }).click();
    await hugo.getByRole('button', { name: 'Envoyer les invitations' }).click();
    await hugo.waitForURL(/\/matches\/[0-9a-f-]+$/);

    await lucas.goto('/leaderboard');
    const alerts = lucas.getByRole('link', { name: /Alertes/ });
    await expect(alerts).toContainText('1');

    await lucas.goto('/notifications');
    await expect(lucas.getByText('1 non lue')).toBeVisible();
    await lucas.getByRole('button', { name: 'Tout marquer comme lu' }).click();
    await expect(lucas.getByText('Tout est lu.')).toBeVisible();
  });

  test('accepting tells the inviter the match has started', async ({ browser }) => {
    const antoine = await asPlayer(browser, 'antoine');
    const baptiste = await asPlayer(browser, 'baptiste');

    await antoine.goto('/games');
    await antoine.getByRole('link', { name: /Palet/ }).click();
    await antoine.getByRole('button', { name: new RegExp(`^${PLAYERS.baptiste.name}`) }).click();
    await antoine.getByRole('button', { name: 'Envoyer les invitations' }).click();
    await antoine.waitForURL(/\/matches\/[0-9a-f-]+$/);
    const matchId = antoine.url().split('/matches/')[1] as string;

    await baptiste.goto(`/matches/${matchId}`);
    await baptiste.getByRole('button', { name: 'Accepter le défi' }).click();
    await expect(baptiste.getByText('En cours')).toBeVisible();

    await antoine.goto('/notifications');
    await expect(antoine.getByRole('button', { name: /La partie commence/ })).toBeVisible();
  });

  test('the explanation screen asks for permission, never the browser on page load', async ({
    browser,
  }) => {
    // Rule 2: a prompt that appears unprompted gets dismissed reflexively, and
    // that dismissal is hard to undo.
    const player = await asPlayer(browser, 'antoine');
    await player.goto('/install');
    await expect(
      player.getByRole('heading', { name: 'Reçois les défis à temps' }),
    ).toBeVisible();
    await expect(player.getByText('Pourquoi activer les alertes ?')).toBeVisible();
    await expect(
      player.getByText('Une invitation à jouer expire au bout de 5 minutes'),
    ).toBeVisible();
  });
});
