/**
 * Logging in, through the real interface.
 *
 * Deliberately not a cookie shortcut: login is the first thing every guest
 * does, on a phone, once — so every journey paying the two seconds to go
 * through the keypad means the keypad can never quietly break.
 */
import { expect, type Page } from '@playwright/test';

import { DEV_PIN, e2eUsers } from '../../src/db/seed/users.e2e';

/** Re-exported so the specs have one import for everything roster-shaped. */
export { DEV_PIN };

/**
 * Named handles on the E2E roster.
 *
 * Resolved FROM `e2eUsers` rather than copied out of it. The suite used to
 * hardcode these, so replacing the seed with the real guest list left every
 * test looking for people who no longer existed — and the symptom was a
 * 45-second locator timeout, not a message about the roster.
 */
function player(id: string) {
  const found = e2eUsers.find((u) => u.id === id);
  if (!found) {
    throw new Error(
      `e2e: no player '${id}' in the E2E roster. ` +
        `Add them to src/db/seed/users.e2e.ts, or fix the key here. ` +
        `Known: ${e2eUsers.map((u) => u.id).join(', ')}`,
    );
  }
  return { id: found.id, name: found.name, role: found.role } as const;
}

export const PLAYERS = {
  quentin: player('quentin'),
  jumeau1: player('jumeau-1'),
  antoine: player('antoine'),
  baptiste: player('baptiste'),
  clement: player('clement'),
  hugo: player('hugo'),
  lucas: player('lucas'),
  romain: player('romain'),
  thomas: player('thomas'),
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
