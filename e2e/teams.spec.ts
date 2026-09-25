import { expect, test, type Browser, type Page } from '@playwright/test';

import { DEV_PIN, PLAYERS, login, pickPlayer, typePin } from './helpers/auth';
import {
  clearTeamFor,
  pointTotal,
  resetVolatileState,
  teamPointEventTypes,
  teamPointTotal,
  teamSlugOf,
} from './helpers/db';

/**
 * The two teams (spec 0017).
 *
 * The four journeys nothing else can prove: the gate that sends a teamless
 * player to the choice screen and back to where they were going, the team
 * that is a player ahead being refused out loud, a captain being offered
 * nothing at all, and a match moving the two leaderboards by different
 * amounts — the team's once, each winner's in full.
 *
 * The seeded split is 5 (Julien) against 3 (Pierre), with Thomas placed
 * nowhere. That is what makes "one team is ahead" reachable at all.
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
): Promise<void> {
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
}

test.beforeEach(() => resetVolatileState());

test.describe('Choosing a team', { tag: '@spec-0017' }, () => {
  test('a deep link sends a teamless player to the choice screen and back', async ({
    page,
  }) => {
    // `resetVolatileState()` leaves `users` alone, so a choice is permanent
    // for the life of the database — without this the test passes once and
    // fails on the retry (spec 0017, end-to-end coverage).
    clearTeamFor(PLAYERS.thomas.id);

    await page.goto('/history');
    await expect(page).toHaveURL(/\/\?next=%2Fhistory$/);

    await pickPlayer(page, PLAYERS.thomas.name);
    await typePin(page, DEV_PIN);

    // Not the history: nothing in the app is reachable without a team.
    await page.waitForURL(/\/team-choice\?next=%2Fhistory$/);
    await expect(page.getByRole('heading', { name: 'Choisis ton camp' })).toBeVisible();

    // Nine players, so a team is full at five and Julien is seeded at
    // exactly that: it is offered DISABLED, naming itself and the reason
    // (rule 16) — never silently absent.
    const julien = page.locator('[data-team="julien"]');
    const pierre = page.locator('[data-team="pierre"]');
    await expect(julien).toBeDisabled();
    await expect(julien).toContainText('est complète');
    await expect(pierre).toBeEnabled();

    // Picking is not joining: the choice is final, so it takes a second,
    // deliberate action (rule 17).
    await pierre.click();
    await page.getByTestId('confirm-team').click();

    // …and the guest lands where they were going all along (rule 11).
    await page.waitForURL(/\/history$/);
    await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible();
    expect(teamSlugOf(PLAYERS.thomas.id)).toBe('pierre');
  });

  test('a player who has chosen cannot choose again', async ({ browser }) => {
    const player = await asPlayer(browser, 'antoine');
    await player.goto('/team-choice');

    await expect(player.getByTestId('team-option')).toHaveCount(0);
    await expect(player.getByText('Équipe Julien').first()).toBeVisible();
    await expect(player.getByText(/le choix était définitif/i)).toBeVisible();
  });

  test('a captain is told they are one, and is offered nothing', async ({ browser }) => {
    // Rule 9: a captain is seeded onto their own team and cannot leave it.
    const captain = await asPlayer(browser, 'quentin');
    await captain.goto('/team-choice');

    await expect(captain.getByText(/Tu es le capitaine de/)).toBeVisible();
    await expect(captain.getByTestId('team-option')).toHaveCount(0);
  });
});

test.describe('What a match moves', { tag: '@spec-0017' }, () => {
  test('a match between the two teams moves both leaderboards', async ({ browser }) => {
    // Antoine plays for Julien, Lucas for Pierre.
    await playAndWin(browser, 'antoine', 'lucas', ['13', '2']);

    // The winner is credited in full: 10 for the win, 11 for the margin.
    expect(pointTotal(PLAYERS.antoine.id)).toBe(21);
    // The team is credited ONCE — one row per type, whatever the side size.
    expect(teamPointTotal('julien')).toBe(21);
    // Sorted: both rows carry the same timestamp, so the helper's tiebreak is
    // the type name and the order says nothing.
    expect(teamPointEventTypes('julien').sort()).toEqual(['margin_bonus', 'match_win']);
    expect(teamPointTotal('pierre')).toBe(0);

    const player = await asPlayer(browser, 'hugo');
    await player.goto('/leaderboard');
    await player.getByRole('link', { name: 'Équipes' }).click();

    await expect(player.getByRole('heading', { name: 'Les deux équipes' })).toBeVisible();
    const julien = player.locator('[data-team="julien"]');
    await expect(julien).toHaveAttribute('data-points', '21');
    await expect(julien).toHaveAttribute('data-rank', '1');
    await expect(julien).toContainText('5 joueurs');
    await expect(julien).toContainText('1 partie gagnée');

    // The two leaderboards are never added together (rule 26).
    await player.getByRole('link', { name: 'Joueurs' }).click();
    const row = player.getByTestId('standing').filter({ hasText: PLAYERS.antoine.name });
    await expect(row).toHaveAttribute('data-points', '21');
  });

  test('an intra-team duel is refused at creation', async ({ browser }) => {
    // Rule 20: an intra-team duel is strictly forbidden.
    const antoine = await asPlayer(browser, 'antoine');
    await antoine.goto('/games');
    await antoine.getByRole('link', { name: /Palet/ }).click();

    // Baptiste is in the same team as Antoine (Team Julien).
    const baptisteOption = antoine.getByRole('button', {
      name: new RegExp(`^${PLAYERS.baptiste.name}`),
    });
    await expect(baptisteOption).toBeDisabled();
    await expect(antoine.getByText('même équipe').first()).toBeVisible();
  });

  test('an admin adjustment on a player is reflected in the team total score', async ({
    browser,
  }) => {
    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin');
    await admin.getByLabel('Joueur', { exact: true }).selectOption(PLAYERS.clement.id);
    await admin.getByPlaceholder('ex. 25 ou -10').fill('20');
    await admin
      .getByPlaceholder('ex. Vainqueur du concours de grimaces')
      .fill('Vainqueur du concours');
    await admin.getByRole('button', { name: 'Ajuster les points' }).click();
    await expect(admin.getByText('Ajustement enregistré.')).toBeVisible();

    expect(pointTotal(PLAYERS.clement.id)).toBe(20);

    const player = await asPlayer(browser, 'hugo');
    await player.goto('/teams');
    const julien = player.locator('[data-team="julien"]');
    await expect(julien).toHaveAttribute('data-points', '20');
    await expect(julien).toContainText('20 pts individuels · 0 pt de clash');
  });
});
