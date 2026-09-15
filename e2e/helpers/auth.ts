/**
 * Logging in, through the real interface.
 *
 * Deliberately not a cookie shortcut: login is the first thing every guest
 * does, on a phone, once — so every journey paying the two seconds to go
 * through the keypad means the keypad can never quietly break.
 */
import { expect, type Page } from '@playwright/test';

/** The shared development PIN from the seed (spec 0002). */
export const DEV_PIN = '123456';

export const PLAYERS = {
  quentin: { id: 'quentin', name: 'Quentin', role: 'admin' },
  jumeau1: { id: 'jumeau-1', name: 'Jumeau 1', role: 'admin' },
  antoine: { id: 'antoine', name: 'Antoine', role: 'user' },
  baptiste: { id: 'baptiste', name: 'Baptiste', role: 'user' },
  clement: { id: 'clement', name: 'Clément', role: 'user' },
  hugo: { id: 'hugo', name: 'Hugo', role: 'user' },
  lucas: { id: 'lucas', name: 'Lucas', role: 'user' },
  romain: { id: 'romain', name: 'Romain', role: 'user' },
  thomas: { id: 'thomas', name: 'Thomas', role: 'user' },
} as const;

export type PlayerKey = keyof typeof PLAYERS;

/** Types a PIN on the keypad. Scoped to the keypad so "1" is a digit here. */
export async function typePin(page: Page, pin: string): Promise<void> {
  const keypad = page.getByTestId('pin-keypad');
  for (const digit of pin) {
    await keypad.getByRole('button', { name: digit, exact: true }).click();
  }
}

export async function pickPlayer(page: Page, name: string): Promise<void> {
  await page.getByLabel('Cherche ton prénom').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
  // The keypad replaces the roster; waiting for it avoids typing into a list.
  await expect(page.getByTestId('pin-keypad')).toBeVisible();
}

/** Full journey: land on the login screen, pick a name, enter the PIN. */
export async function login(page: Page, player: PlayerKey): Promise<void> {
  const { name } = PLAYERS[player];
  await page.goto('/');
  await pickPlayer(page, name);
  await typePin(page, DEV_PIN);
  // It submits on the sixth digit (spec 0001, rule 4) — no button to press.
  await expect(page.getByRole('heading', { name: 'Classement' })).toBeVisible();
}
