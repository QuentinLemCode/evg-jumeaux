import { expect, test } from '@playwright/test';

import { login } from './helpers/auth';

/**
 * The responsive shell and the PWA (spec 0009).
 *
 * Runs in BOTH projects: the mobile one is the reference viewport, the desktop
 * one only has to prove the shell adapts. The horizontal-scroll assertion is
 * the highest-value one here — it is the failure a designer never sees on a
 * laptop and every guest sees on a phone.
 */
const ROUTES = ['/leaderboard', '/games', '/history', '/admin-log', '/notifications', '/install'];

test.describe('The app shell', { tag: ['@spec-0009', '@spec-0010'] }, () => {
  test('no screen scrolls sideways, at any width the app supports', async ({ page }, info) => {
    await login(page, 'quentin');

    const widths = info.project.name === 'desktop' ? [768, 1280] : [320, 390];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of ROUTES) {
        await page.goto(route);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} overflows horizontally at ${width}px`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('exactly one navigation is visible, and it is the right one', async ({ page }, info) => {
    await login(page, 'quentin');
    // The bottom bar is `md:hidden`, the sidebar `hidden md:block`: at any
    // width precisely one of them renders, never both and never neither.
    const destination = page.getByRole('link', { name: 'Classement' });
    await expect(destination).toHaveCount(1);
    await expect(destination).toBeVisible();

    const box = await destination.boundingBox();
    expect(box).not.toBeNull();
    if (info.project.name === 'desktop') {
      // A sidebar: near the left edge, well above the bottom of the window.
      expect(box!.x).toBeLessThan(240);
    } else {
      const viewport = page.viewportSize()!;
      expect(box!.y).toBeGreaterThan(viewport.height - 140);
    }
  });

  test('every navigation target is at least 44px tall', async ({ page }) => {
    // Spec 0010 §6: nothing tappable is smaller than 44px.
    await login(page, 'quentin');
    for (const label of ['Classement', 'Jeux', 'Historique', 'Alertes', 'Admin']) {
      const box = await page.getByRole('link', { name: label }).boundingBox();
      expect(box, `${label} has no box`).not.toBeNull();
      expect(box!.height, `${label} is ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
    }
  });

  test('an admin sees five destinations, a player four', async ({ page, browser }) => {
    await login(page, 'quentin');
    await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();

    const context = await browser.newContext();
    const playerPage = await context.newPage();
    await login(playerPage, 'antoine');
    await expect(playerPage.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    await expect(playerPage.getByRole('link', { name: 'Historique' })).toBeVisible();
  });
});
