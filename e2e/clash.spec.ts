import { expect, test, type Browser, type Page } from '@playwright/test';

import { PLAYERS, login } from './helpers/auth';
import { matchStatus, resetVolatileState } from './helpers/db';

/**
 * The weekend's set piece (spec 0017, rules 3-7).
 *
 * Two things nothing else can prove. First, that a clash runs **alongside**
 * the evening: it starts while a darts match is under way, and nobody in it
 * is made unavailable for anything — three separate pieces of code decide who
 * is busy, and a miss in any one of them shows up here and nowhere else.
 * Second, that both ends of it are announced to everybody except the person
 * who caused them, which is the only thing telling the other guests the set
 * piece has begun: a clash has no invitation to arrive.
 */
async function asPlayer(browser: Browser, player: keyof typeof PLAYERS): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, player);
  return page;
}

const CLASH_GAME = 'Le grand match';

/** Creates the clash game. There is none in the seed: an admin adds it. */
async function createClashGame(admin: Page): Promise<void> {
  await admin.goto('/admin/games');
  await admin.getByRole('button', { name: '+ Créer un jeu' }).click();
  await admin.getByPlaceholder('ex. Molkky').fill(CLASH_GAME);
  await admin.getByRole('button', { name: 'Les deux équipes' }).click();
  await admin.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(admin.getByText(CLASH_GAME)).toBeVisible();
}

/** Starts it, and returns the match id. */
async function startClash(admin: Page): Promise<string> {
  await admin.goto('/games');
  await admin.getByRole('link', { name: new RegExp(CLASH_GAME) }).click();
  await admin.getByRole('button', { name: 'Lancer le match des deux équipes' }).click();
  await admin.waitForURL(/\/matches\/[0-9a-f-]+$/);
  return admin.url().split('/matches/')[1] as string;
}

/** An ordinary duel, left running. Returns its id. */
async function startDarts(
  challenger: Page,
  opponent: Page,
  opponentName: string,
): Promise<string> {
  await challenger.goto('/games');
  await challenger.getByRole('link', { name: /Fléchettes/ }).click();
  await challenger.getByRole('button', { name: new RegExp(`^${opponentName}`) }).click();
  await challenger.getByRole('button', { name: 'Envoyer les invitations' }).click();
  await challenger.waitForURL(/\/matches\/[0-9a-f-]+$/);
  const matchId = challenger.url().split('/matches/')[1] as string;

  await opponent.goto(`/matches/${matchId}`);
  await opponent.getByRole('button', { name: 'Accepter le défi' }).click();
  await expect(opponent.getByText('En cours', { exact: true })).toBeVisible();
  return matchId;
}

test.beforeEach(() => resetVolatileState());

test.describe('The clash', { tag: '@spec-0017' }, () => {
  test('starts beside a running match and blocks nobody', async ({ browser }) => {
    const admin = await asPlayer(browser, 'quentin');
    const antoine = await asPlayer(browser, 'antoine');
    const lucas = await asPlayer(browser, 'lucas');

    // Darts first, and still going when the set piece is called.
    const darts = await startDarts(antoine, lucas, PLAYERS.lucas.name);

    await createClashGame(admin);
    const clash = await startClash(admin);

    // Both live. The busy rule stopped neither (spec 0017, rule 6).
    expect(matchStatus(darts)).toBe('active');
    expect(matchStatus(clash)).toBe('active');
    await expect(admin.getByText('En cours', { exact: true })).toBeVisible();

    // Two players whose ONLY match is the clash challenge each other, and the
    // invitation is accepted. That last step is its own busy query, and a
    // miss there refuses every invitation of the evening.
    const baptiste = await asPlayer(browser, 'baptiste');
    const romain = await asPlayer(browser, 'romain');
    const duel = await startDarts(baptiste, romain, PLAYERS.romain.name);
    expect(matchStatus(duel)).toBe('active');

    // A SECOND clash is the one thing refused: both would claim the same two
    // teams in full (rule 6).
    await admin.goto('/games');
    await admin.getByRole('link', { name: new RegExp(CLASH_GAME) }).click();
    await admin.getByRole('button', { name: 'Lancer le match des deux équipes' }).click();
    await expect(admin.getByTestId('form-error')).toContainText(
      'Un match d’équipes est déjà en cours',
    );

    // Announced to every participant except the admin who called it (rule 7).
    await baptiste.goto('/notifications');
    await expect(baptiste.getByText(/Le grand match commence/)).toBeVisible();

    await admin.goto('/notifications');
    await expect(admin.getByText(/Le grand match commence/)).toHaveCount(0);
  });

  test('tells everybody but the validator when it is over', async ({ browser }) => {
    const admin = await asPlayer(browser, 'quentin');
    const lucas = await asPlayer(browser, 'lucas');
    const romain = await asPlayer(browser, 'romain');

    await createClashGame(admin);
    const clash = await startClash(admin);

    // The admin captains Julien, so their team is camp 1 (spec 0004, rule 2).
    await admin.getByRole('button', { name: 'Saisir le résultat' }).click();
    await admin.getByRole('button', { name: /Équipe Julien/ }).click();
    await admin.getByRole('button', { name: 'Envoyer pour validation' }).click();

    // Lucas plays for Pierre, the side that owes the validation.
    await lucas.goto(`/matches/${clash}`);
    await lucas.getByRole('button', { name: 'Je confirme ce résultat' }).click();
    await expect(lucas.getByText('Terminée', { exact: true })).toBeVisible();
    expect(matchStatus(clash)).toBe('completed');

    // Everybody is told — except Lucas, who just said it himself (rule 7).
    await romain.goto('/notifications');
    await expect(romain.getByText(/Le grand match est terminé/)).toBeVisible();

    await admin.goto('/notifications');
    await expect(admin.getByText(/Le grand match est terminé/)).toBeVisible();

    await lucas.goto('/notifications');
    await expect(lucas.getByText(/Le grand match est terminé/)).toHaveCount(0);
  });
});
