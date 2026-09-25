import { expect, test, type Browser, type Page } from '@playwright/test';

import { PLAYERS, login } from './helpers/auth';
import { matchStatus, pointTotal, resetVolatileState, teamSlugOf } from './helpers/db';

/**
 * The admin console (specs 0003, 0008).
 *
 * The rule every test here defends: an admin action is never silent. It either
 * notifies the people affected or lands in the public log, and usually both —
 * because a fix nobody can see is indistinguishable from cheating.
 */
async function asPlayer(browser: Browser, player: keyof typeof PLAYERS): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, player);
  return page;
}

test.beforeEach(() => resetVolatileState());

test.describe('Managing games', { tag: '@spec-0003' }, () => {
  test('an admin creates a game and players can immediately use it', async ({ browser }) => {
    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin/games');
    await admin.getByRole('button', { name: '+ Créer un jeu' }).click();

    await admin.getByPlaceholder('ex. Molkky').fill('Molkky');
    await admin.getByPlaceholder('ex. Premier à 50 points pile').fill('Premier à 50 pile');
    await admin.getByRole('button', { name: 'Chacun pour soi' }).click();
    await admin.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(admin.getByText('Molkky')).toBeVisible();

    // A player sees it in the catalog without anyone redeploying anything.
    const player = await asPlayer(browser, 'antoine');
    await player.goto('/games');
    await expect(player.getByRole('link', { name: /Molkky/ })).toBeVisible();
  });

  test('a duplicate name, ignoring case, is refused', async ({ browser }) => {
    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin/games');
    await admin.getByRole('button', { name: '+ Créer un jeu' }).click();
    await admin.getByPlaceholder('ex. Molkky').fill('palet');
    await admin.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(admin.getByTestId('form-error')).toContainText('Un jeu porte déjà ce nom');
  });

  test('an archived game disappears from the catalog but stays in the admin list', async ({
    browser,
  }) => {
    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin/games');

    const paletCard = admin.locator('li').filter({ hasText: 'Fléchettes' }).first();
    await paletCard.getByRole('button', { name: 'Archiver' }).click();
    await expect(admin.getByText('Archivé')).toBeVisible();

    const player = await asPlayer(browser, 'antoine');
    await player.goto('/games');
    await expect(player.getByRole('link', { name: /Fléchettes/ })).toHaveCount(0);
    await expect(player.getByRole('link', { name: /Palet/ })).toBeVisible();
  });

  test('a player sees no way to manage games', async ({ browser }) => {
    const player = await asPlayer(browser, 'antoine');
    await player.goto('/games');
    await expect(player.getByRole('link', { name: 'Gérer' })).toHaveCount(0);
  });
});

test.describe('Adjusting points by hand', { tag: '@spec-0008' }, () => {
  test('an adjustment needs a reason, and the reason becomes public', async ({ browser }) => {
    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin');

    await admin.getByLabel('Joueur', { exact: true }).selectOption(PLAYERS.clement.id);
    await admin.getByPlaceholder('ex. 25 ou -10').fill('25');

    // Four characters: refused, because a blank reason is how a well-meaning
    // admin creates an unexplainable leaderboard (spec 0008, rule 12).
    await admin.getByPlaceholder('ex. Vainqueur du concours de grimaces').fill('bof');
    await expect(admin.getByRole('button', { name: 'Ajuster les points' })).toBeDisabled();

    await admin
      .getByPlaceholder('ex. Vainqueur du concours de grimaces')
      .fill('Vainqueur du concours de grimaces');
    await admin.getByRole('button', { name: 'Ajuster les points' }).click();
    await expect(admin.getByText('Ajustement enregistré.')).toBeVisible();

    expect(pointTotal(PLAYERS.clement.id)).toBe(25);

    // It shows up in the target's PUBLIC profile, attributed and explained.
    const anyone = await asPlayer(browser, 'hugo');
    await anyone.goto(`/players/${PLAYERS.clement.id}`);
    await expect(anyone.getByText('Ajustement admin')).toBeVisible();
    await expect(anyone.getByText('Vainqueur du concours de grimaces')).toBeVisible();
    await expect(anyone.getByText('+25', { exact: true })).toBeVisible();
  });

  test('points can be taken away as well as given', async ({ browser }) => {
    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin');
    await admin.getByLabel('Joueur', { exact: true }).selectOption(PLAYERS.romain.id);
    await admin.getByPlaceholder('ex. 25 ou -10').fill('-10');
    await admin
      .getByPlaceholder('ex. Vainqueur du concours de grimaces')
      .fill('Pénalité : a cassé un palet');
    await admin.getByRole('button', { name: 'Ajuster les points' }).click();
    await expect(admin.getByText('Ajustement enregistré.')).toBeVisible();

    expect(pointTotal(PLAYERS.romain.id)).toBe(-10);
  });
});

test.describe('Arbitrating a dispute', { tag: '@spec-0008' }, () => {
  test('a disputed result awards nothing until an admin decides, with a reason', async ({
    browser,
  }) => {
    const antoine = await asPlayer(browser, 'antoine');
    const baptiste = await asPlayer(browser, 'baptiste');

    // --- play a match and dispute the result -----------------------------
    await antoine.goto('/games');
    await antoine.getByRole('link', { name: /Palet/ }).click();
    await antoine.getByRole('button', { name: new RegExp(`^${PLAYERS.baptiste.name}`) }).click();
    await antoine.getByRole('button', { name: 'Envoyer les invitations' }).click();
    await antoine.waitForURL(/\/matches\/[0-9a-f-]+$/);
    const matchId = antoine.url().split('/matches/')[1] as string;

    await baptiste.goto(`/matches/${matchId}`);
    await baptiste.getByRole('button', { name: 'Accepter le défi' }).click();
    await expect(baptiste.getByText('En cours', { exact: true })).toBeVisible();

    await antoine.goto(`/matches/${matchId}`);
    await antoine.getByRole('button', { name: 'Saisir le résultat' }).click();
    await antoine.getByRole('button', { name: new RegExp(`^${PLAYERS.antoine.name}`) }).click();
    await antoine.getByLabel(`Score de ${PLAYERS.antoine.name}`).fill('13');
    await antoine.getByLabel(`Score de ${PLAYERS.baptiste.name}`).fill('11');
    await antoine.getByRole('button', { name: 'Envoyer pour validation' }).click();
    await expect(antoine.getByText('À valider', { exact: true })).toBeVisible();

    await baptiste.goto(`/matches/${matchId}`);
    await baptiste.getByRole('button', { name: 'Ce n’est pas ce qui s’est passé' }).click();
    await baptiste.getByPlaceholder('Optionnel, mais ça aide l’admin à trancher').fill(
      'C’est moi qui ai gagné 13-11',
    );
    await baptiste.getByRole('button', { name: 'Contester' }).click();

    await expect(baptiste.getByText('Contestée', { exact: true })).toBeVisible();
    expect(matchStatus(matchId)).toBe('disputed');
    // Nothing is awarded while it is contested (spec 0004, rule 20).
    expect(pointTotal(PLAYERS.antoine.id)).toBe(0);
    expect(pointTotal(PLAYERS.baptiste.id)).toBe(0);

    // --- the admin arbitrates, and must say why --------------------------
    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin');
    await expect(admin.getByText('C’est moi qui ai gagné 13-11')).toBeVisible();

    await admin.getByRole('button', { name: 'Trancher' }).click();
    await admin.getByRole('button', { name: PLAYERS.baptiste.name, exact: true }).click();
    await admin.getByLabel(`Score de ${PLAYERS.antoine.name}`).fill('11');
    await admin.getByLabel(`Score de ${PLAYERS.baptiste.name}`).fill('13');

    // Without a reason the decision cannot be saved (spec 0008, rule 3).
    await expect(admin.getByRole('button', { name: 'Valider la décision' })).toBeDisabled();
    await admin
      .getByPlaceholder('Pourquoi cette décision ? (visible par tous)')
      .fill('Deux témoins confirment le score de Baptiste');
    await admin.getByRole('button', { name: 'Valider la décision' }).click();

    await expect(admin.getByText('Aucune contestation')).toBeVisible();
    expect(matchStatus(matchId)).toBe('completed');

    // Baptiste wins: 10 for the match + 2 for the 13–11 margin.
    expect(pointTotal(PLAYERS.baptiste.id)).toBe(12);
    expect(pointTotal(PLAYERS.antoine.id)).toBe(0);
  });
});

test.describe('Resetting tournament before kickoff', { tag: '@spec-0008' }, () => {
  test('an admin resets all scores, history and teams with typed confirmation', async ({
    browser,
  }) => {
    const admin = await asPlayer(browser, 'quentin');
    // First give points to Clément via adjustment
    await admin.goto('/admin');
    await admin.getByLabel('Joueur', { exact: true }).selectOption(PLAYERS.clement.id);
    await admin.getByPlaceholder('ex. 25 ou -10').fill('50');
    await admin
      .getByPlaceholder('ex. Vainqueur du concours de grimaces')
      .fill('Points test avant remise à zéro');
    await admin.getByRole('button', { name: 'Ajuster les points' }).click();
    await expect(admin.getByText('Ajustement enregistré.')).toBeVisible();
    expect(pointTotal(PLAYERS.clement.id)).toBe(50);

    // Open reset popup
    await admin.getByRole('button', { name: 'Remettre tout à zéro' }).click();
    await expect(admin.getByText('Remise à zéro du jeu')).toBeVisible();

    // Confirm button is disabled if empty
    const confirmButton = admin.getByRole('button', { name: 'Confirmer' });
    await expect(confirmButton).toBeDisabled();

    // Type something invalid
    await admin.getByPlaceholder('confirmer').fill('mauvais');
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();
    await expect(admin.getByTestId('form-error')).toContainText('Tape « confirmer » pour valider');

    // Type "confirmer"
    await admin.getByPlaceholder('confirmer').fill('confirmer');
    await confirmButton.click();

    // After reset, points are 0
    await expect(admin.getByText('Remise à zéro avant le début')).toBeVisible();
    expect(pointTotal(PLAYERS.clement.id)).toBe(0);
    // Non-captain player team has been reset
    expect(teamSlugOf(PLAYERS.clement.id)).toBeNull();
    // Captain player team is preserved
    expect(teamSlugOf(PLAYERS.quentin.id)).toBe('julien');
  });

  test('a plain player cannot reach admin console', async ({ browser }) => {
    const player = await asPlayer(browser, 'antoine');
    await player.goto('/admin');
    await expect(player).toHaveURL(/\/leaderboard/);
  });
});

