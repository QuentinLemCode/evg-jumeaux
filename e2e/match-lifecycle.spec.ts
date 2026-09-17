import { expect, test, type Browser, type Page } from '@playwright/test';

import { PLAYERS, login } from './helpers/auth';
import {
  createExpiredInvitation,
  matchStatus,
  pointEventTypes,
  pointTotal,
  resetVolatileState,
} from './helpers/db';

/**
 * The match lifecycle, end to end, through two real browsers (specs 0004,
 * 0005).
 *
 * This is the suite that matters most: invite → accept → report → validate is
 * the product, and it is the one flow no unit test can prove, because it needs
 * two people, two sessions and a server.
 */

/** A second player in their own browser context — their own cookies. */
async function asPlayer(browser: Browser, player: keyof typeof PLAYERS): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, player);
  return page;
}

async function startDuel(page: Page, game: string, opponent: string): Promise<string> {
  await page.getByRole('link', { name: 'Jeux' }).click();
  await expect(page.getByRole('heading', { name: 'Choisis un jeu' })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(game) }).click();

  await expect(page.getByRole('heading', { name: 'Nouvelle partie' })).toBeVisible();
  // A duel defaults to filling side 2, so picking the opponent is the whole
  // interaction (spec 0004, rule 1).
  await page.getByRole('button', { name: new RegExp(`^${opponent}`) }).click();
  await page.getByRole('button', { name: 'Envoyer les invitations' }).click();

  await page.waitForURL(/\/matches\/[0-9a-f-]+$/);
  return page.url().split('/matches/')[1] as string;
}

test.beforeEach(() => resetVolatileState());

test.describe('A match from invitation to points', { tag: ['@spec-0004', '@spec-0005'] }, () => {
  test('invite, accept, report, validate — and the points are itemised', async ({
    browser,
  }) => {
    const antoine = await asPlayer(browser, 'antoine');
    const baptiste = await asPlayer(browser, 'baptiste');

    // --- Antoine challenges Baptiste at Palet ---------------------------
    const matchId = await startDuel(antoine, 'Palet', PLAYERS.baptiste.name);
    await expect(antoine.getByText('En attente', { exact: true })).toBeVisible();
    await expect(antoine.getByText(/Invitation expire dans/)).toBeVisible();
    expect(matchStatus(matchId)).toBe('pending');

    // Nobody has scored for merely being invited.
    expect(pointTotal(PLAYERS.antoine.id)).toBe(0);

    // --- Baptiste is told, and accepts ----------------------------------
    await baptiste.goto('/leaderboard');
    await expect(baptiste.getByText('À toi de jouer')).toBeVisible();

    await baptiste.goto(`/matches/${matchId}`);
    await baptiste.getByRole('button', { name: 'Accepter le défi' }).click();
    await expect(baptiste.getByText('En cours')).toBeVisible();
    expect(matchStatus(matchId)).toBe('active');

    // --- while it runs, neither of them can start another ---------------
    await antoine.goto('/games');
    await expect(antoine.getByText('Tu as déjà une partie en cours.')).toBeVisible();

    // --- Antoine reports 13–2 -------------------------------------------
    await antoine.goto(`/matches/${matchId}`);
    await antoine.getByRole('button', { name: 'Saisir le résultat' }).click();
    await antoine.getByRole('button', { name: new RegExp(`^${PLAYERS.antoine.name}`) }).click();
    await antoine.getByLabel(`Score de ${PLAYERS.antoine.name}`).fill('13');
    await antoine.getByLabel(`Score de ${PLAYERS.baptiste.name}`).fill('2');
    await antoine.getByRole('button', { name: 'Envoyer pour validation' }).click();

    await expect(antoine.getByText('À valider')).toBeVisible();
    expect(matchStatus(matchId)).toBe('awaiting_validation');
    // Still nothing awarded: the other side has not confirmed (spec 0004, rule 17).
    expect(pointTotal(PLAYERS.antoine.id)).toBe(0);

    // The reporter cannot confirm his own result (spec 0004, rule 18).
    await expect(antoine.getByRole('button', { name: 'Je confirme ce résultat' })).toHaveCount(0);
    await expect(
      antoine.getByText('En attente de la validation de l’autre camp.'),
    ).toBeVisible();

    // --- Baptiste confirms, and only then are points awarded ------------
    await baptiste.goto(`/matches/${matchId}`);
    await baptiste.getByRole('button', { name: 'Je confirme ce résultat' }).click();
    await expect(baptiste.getByText('Terminée')).toBeVisible();
    expect(matchStatus(matchId)).toBe('completed');

    // 10 for the win + 11 for the 13–2 margin, as TWO lines with their
    // arithmetic spelled out (spec 0005, rule 12).
    await expect(baptiste.getByText('Points attribués')).toBeVisible();
    await expect(baptiste.getByText('Victoire — Palet')).toBeVisible();
    await expect(baptiste.getByText('Écart 13–2 × 1 pt')).toBeVisible();
    await expect(baptiste.getByText('+10', { exact: true })).toBeVisible();
    await expect(baptiste.getByText('+11', { exact: true })).toBeVisible();

    expect(pointTotal(PLAYERS.antoine.id)).toBe(21);
    expect(pointEventTypes(PLAYERS.antoine.id)).toEqual(['match_win', 'margin_bonus']);
    // The loser gets no rows at all — zero is the absence of a row.
    expect(pointTotal(PLAYERS.baptiste.id)).toBe(0);
    expect(pointEventTypes(PLAYERS.baptiste.id)).toEqual([]);

    // --- and the leaderboard agrees -------------------------------------
    await antoine.goto('/leaderboard');
    const row = antoine.getByTestId('standing').filter({ hasText: PLAYERS.antoine.name });
    await expect(row).toHaveAttribute('data-points', '21');
    await expect(row).toHaveAttribute('data-rank', '1');

    // Both are free again (spec 0004, rule 7).
    await antoine.goto('/games');
    await expect(antoine.getByText('Tu as déjà une partie en cours.')).toHaveCount(0);
  });

  test('one refusal cancels the whole match and nobody scores', async ({ browser }) => {
    const hugo = await asPlayer(browser, 'hugo');
    const lucas = await asPlayer(browser, 'lucas');

    const matchId = await startDuel(hugo, 'Palet', PLAYERS.lucas.name);

    await lucas.goto(`/matches/${matchId}`);
    await lucas.getByRole('button', { name: 'Refuser' }).click();

    await expect(lucas.getByText('Annulée')).toBeVisible();
    expect(matchStatus(matchId)).toBe('cancelled');
    expect(pointTotal(PLAYERS.hugo.id)).toBe(0);
    expect(pointTotal(PLAYERS.lucas.id)).toBe(0);

    // Hugo is free immediately; a refusal must not lock him out.
    await hugo.goto('/games');
    await expect(hugo.getByText('Tu as déjà une partie en cours.')).toHaveCount(0);
  });

  test('a busy player cannot be invited', async ({ browser }) => {
    const antoine = await asPlayer(browser, 'antoine');
    const baptiste = await asPlayer(browser, 'baptiste');
    const clement = await asPlayer(browser, 'clement');

    const matchId = await startDuel(antoine, 'Palet', PLAYERS.baptiste.name);
    await baptiste.goto(`/matches/${matchId}`);
    await baptiste.getByRole('button', { name: 'Accepter le défi' }).click();
    await expect(baptiste.getByText('En cours')).toBeVisible();

    // Clément tries to challenge someone already playing.
    await clement.goto('/games');
    await clement.getByRole('link', { name: /Palet/ }).click();
    const busyRow = clement.getByRole('button', { name: new RegExp(PLAYERS.antoine.name) });
    await expect(busyRow).toBeDisabled();
    await expect(clement.getByText('déjà en partie').first()).toBeVisible();
  });

  test('a report whose winner does not have the highest score is refused', async ({
    browser,
  }) => {
    const antoine = await asPlayer(browser, 'antoine');
    const baptiste = await asPlayer(browser, 'baptiste');

    const matchId = await startDuel(antoine, 'Palet', PLAYERS.baptiste.name);
    await baptiste.goto(`/matches/${matchId}`);
    await baptiste.getByRole('button', { name: 'Accepter le défi' }).click();
    await expect(baptiste.getByText('En cours')).toBeVisible();

    await antoine.goto(`/matches/${matchId}`);
    await antoine.getByRole('button', { name: 'Saisir le résultat' }).click();
    // Claims the win with the LOWER score (spec 0004, rule 16).
    await antoine.getByRole('button', { name: new RegExp(`^${PLAYERS.antoine.name}`) }).click();
    await antoine.getByLabel(`Score de ${PLAYERS.antoine.name}`).fill('2');
    await antoine.getByLabel(`Score de ${PLAYERS.baptiste.name}`).fill('13');
    await antoine.getByRole('button', { name: 'Envoyer pour validation' }).click();

    await expect(antoine.getByTestId('form-error')).toContainText(
      'Le score du gagnant doit être le plus élevé',
    );
    expect(matchStatus(matchId)).toBe('active');
  });

  test('a match with no scores required needs only a winner', async ({ browser }) => {
    const hugo = await asPlayer(browser, 'hugo');
    const romain = await asPlayer(browser, 'romain');

    // Pierre-feuille-ciseaux records the winner and no score (spec 0003).
    const matchId = await startDuel(hugo, 'Pierre-feuille-ciseaux', PLAYERS.romain.name);
    await romain.goto(`/matches/${matchId}`);
    await romain.getByRole('button', { name: 'Accepter le défi' }).click();
    await expect(romain.getByText('En cours')).toBeVisible();

    await hugo.goto(`/matches/${matchId}`);
    await hugo.getByRole('button', { name: 'Saisir le résultat' }).click();
    await expect(hugo.getByLabel(`Score de ${PLAYERS.hugo.name}`)).toHaveCount(0);
    await hugo.getByRole('button', { name: new RegExp(`^${PLAYERS.hugo.name}`) }).click();
    await hugo.getByRole('button', { name: 'Envoyer pour validation' }).click();

    await romain.goto(`/matches/${matchId}`);
    await romain.getByRole('button', { name: 'Je confirme ce résultat' }).click();
    await expect(romain.getByText('Terminée')).toBeVisible();

    // 3 points and no margin bonus, because there is no score to compare.
    expect(pointTotal(PLAYERS.hugo.id)).toBe(3);
    expect(pointEventTypes(PLAYERS.hugo.id)).toEqual(['match_win']);
  });

  test('an invitation past its deadline can no longer be accepted', async ({ browser }) => {
    // The one fixture the UI cannot build: waiting five real minutes is not a
    // test (spec 0004, rule 13).
    const matchId = createExpiredInvitation({
      gameSlug: 'palet',
      from: PLAYERS.antoine.id,
      to: PLAYERS.baptiste.id,
    });

    const baptiste = await asPlayer(browser, 'baptiste');
    await baptiste.goto(`/matches/${matchId}`);

    // Read as expired without waiting for the background sweep.
    await expect(baptiste.getByText('Expirée')).toBeVisible();
    await expect(baptiste.getByRole('button', { name: 'Accepter le défi' })).toHaveCount(0);
    expect(pointTotal(PLAYERS.antoine.id)).toBe(0);

    // And it no longer holds Antoine hostage.
    const antoine = await asPlayer(browser, 'antoine');
    await antoine.goto('/games');
    await expect(antoine.getByText('Tu as déjà une partie en cours.')).toHaveCount(0);
  });
});
