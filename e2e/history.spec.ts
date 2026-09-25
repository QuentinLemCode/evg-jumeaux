import { expect, test, type Browser, type Page } from '@playwright/test';

import { PLAYERS, login } from './helpers/auth';
import { pointTotal, resetVolatileState } from './helpers/db';

/**
 * History, profiles and the point ledger (specs 0005, 0007).
 *
 * The assertion that carries the most weight: the ledger column on a profile
 * SUMS to the headline total. That is the product promise — "why do I have 21
 * and not 10?" is answered by the screen, not by an argument.
 */
async function asPlayer(browser: Browser, player: keyof typeof PLAYERS): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, player);
  return page;
}

async function playAndWin(
  browser: Browser,
  winner: keyof typeof PLAYERS,
  loser: keyof typeof PLAYERS,
  scores: [string, string],
): Promise<string> {
  const a = await asPlayer(browser, winner);
  const b = await asPlayer(browser, loser);

  await a.goto('/games');
  await a.getByRole('link', { name: /Palet/ }).click();
  await a.getByRole('button', { name: new RegExp(`^${PLAYERS[loser].name}`) }).click();
  await a.getByRole('button', { name: 'Envoyer les invitations' }).click();
  await a.waitForURL(/\/matches\/[0-9a-f-]+$/);
  const matchId = a.url().split('/matches/')[1] as string;

  await b.goto(`/matches/${matchId}`);
  await b.getByRole('button', { name: 'Accepter le défi' }).click();
  await expect(b.getByText('En cours', { exact: true })).toBeVisible();

  await a.goto(`/matches/${matchId}`);
  await a.getByRole('button', { name: 'Saisir le résultat' }).click();
  await a.getByRole('button', { name: new RegExp(`^${PLAYERS[winner].name}`) }).click();
  await a.getByLabel(`Score de ${PLAYERS[winner].name}`).fill(scores[0]);
  await a.getByLabel(`Score de ${PLAYERS[loser].name}`).fill(scores[1]);
  await a.getByRole('button', { name: 'Envoyer pour validation' }).click();

  await b.goto(`/matches/${matchId}`);
  await b.getByRole('button', { name: 'Je confirme ce résultat' }).click();
  await expect(b.getByText('Terminée', { exact: true })).toBeVisible();

  await a.close();
  await b.close();
  return matchId;
}

test.beforeEach(() => resetVolatileState());

test.describe('History', { tag: '@spec-0007' }, () => {
  test('an empty history says so and offers the next move', async ({ browser }) => {
    const player = await asPlayer(browser, 'antoine');
    await player.goto('/history');
    await expect(player.getByText('Aucune partie pour le moment')).toBeVisible();
    await expect(player.getByRole('link', { name: 'Lance la première' })).toBeVisible();
  });

  test('a finished match appears with its score and its winner', async ({ browser }) => {
    await playAndWin(browser, 'antoine', 'lucas', ['13', '4']);

    const player = await asPlayer(browser, 'hugo');
    await player.goto('/history');
    const row = player.locator('a[href^="/matches/"]').filter({ hasText: 'Palet' }).first();
    await expect(row).toContainText('Terminée');
    await expect(row).toContainText(PLAYERS.antoine.name);
    await expect(row).toContainText('13');
    await expect(row).toContainText('4');
  });

  test('a cancelled match is shown, greyed, with its reason', async ({ browser }) => {
    // Hiding them would let a player quietly retry until they win one
    // (spec 0007, rule 4).
    const hugo = await asPlayer(browser, 'hugo');
    const romain = await asPlayer(browser, 'romain');

    await hugo.goto('/games');
    await hugo.getByRole('link', { name: /Palet/ }).click();
    await hugo.getByRole('button', { name: new RegExp(`^${PLAYERS.romain.name}`) }).click();
    await hugo.getByRole('button', { name: 'Envoyer les invitations' }).click();
    await hugo.waitForURL(/\/matches\/[0-9a-f-]+$/);
    const matchId = hugo.url().split('/matches/')[1] as string;

    await romain.goto(`/matches/${matchId}`);
    await romain.getByRole('button', { name: 'Refuser' }).click();
    await expect(romain.getByText('Annulée', { exact: true })).toBeVisible();

    await romain.goto('/history');
    const row = romain.locator('a[href^="/matches/"]').filter({ hasText: 'Palet' }).first();
    await expect(row).toContainText('Annulée');
    await expect(row).toContainText('Invitation refusée');
  });

  test('the history filters by game and by player', async ({ browser }) => {
    await playAndWin(browser, 'antoine', 'lucas', ['13', '2']);

    const player = await asPlayer(browser, 'hugo');
    await player.goto('/history');
    await expect(player.getByRole('link', { name: /Palet/ })).toHaveCount(2); // filter chip + row

    // A player who did not play has no matches under their filter.
    await player.getByRole('link', { name: new RegExp(PLAYERS.thomas.name) }).click();
    await expect(player.getByText('Aucune partie pour le moment')).toBeVisible();
  });
});

test.describe('A player profile and the ledger', { tag: '@spec-0005' }, () => {
  test('the ledger lists every point and sums to the headline total', async ({ browser }) => {
    await playAndWin(browser, 'antoine', 'lucas', ['13', '2']);
    expect(pointTotal(PLAYERS.antoine.id)).toBe(21);

    const player = await asPlayer(browser, 'clement');
    await player.goto(`/players/${PLAYERS.antoine.id}`);

    await expect(player.getByRole('heading', { name: PLAYERS.antoine.name })).toBeVisible();
    await expect(player.getByText('Détail des points')).toBeVisible();
    await expect(player.getByText('Victoire — Palet')).toBeVisible();
    await expect(player.getByText('Écart 13–2 × 1 pt')).toBeVisible();
    // The column sums to the total, verifiable by eye (spec 0007, rule 12).
    await expect(player.getByText('Total')).toBeVisible();
    await expect(player.getByText('21pts')).toBeVisible();
  });

  test('a player who has not played is on the board with zero', async ({ browser }) => {
    const player = await asPlayer(browser, 'antoine');
    await player.goto('/leaderboard');

    const thomas = player.getByTestId('standing').filter({ hasText: PLAYERS.thomas.name });
    await expect(thomas).toHaveAttribute('data-points', '0');
    await expect(thomas).toContainText('Pas encore joué');
  });

  test('the reader always sees their own row without scrolling', async ({ browser }) => {
    // Spec 0005, rule 18.
    const player = await asPlayer(browser, 'clement');
    await player.goto('/leaderboard');
    await expect(player.getByText('Toi', { exact: true })).toBeInViewport();
  });

  test('every player name links to their profile', async ({ browser }) => {
    await playAndWin(browser, 'antoine', 'lucas', ['13', '2']);
    const player = await asPlayer(browser, 'hugo');
    await player.goto('/leaderboard');

    await player.getByTestId('standing').filter({ hasText: PLAYERS.antoine.name }).click();
    await expect(player).toHaveURL(new RegExp(`/players/${PLAYERS.antoine.id}$`));
  });
});
