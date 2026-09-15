import { expect, test } from '@playwright/test';

import { login } from './helpers/auth';

/**
 * Installability and the served contract (specs 0006, 0009).
 *
 * Split from shell.spec.ts on purpose: the desktop project re-runs the shell
 * file to prove the layout adapts, and re-fetching the same manifest in a
 * second browser proves nothing.
 */
test.describe('Installability', { tag: ['@spec-0009', '@spec-0006'] }, () => {
  test('the manifest is served and installable', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);

    const manifest = (await response.json()) as {
      display: string;
      start_url: string;
      icons: { sizes: string; purpose?: string }[];
    };
    // `standalone` is not cosmetic: on iOS, Web Push only works from an
    // installed web app (spec 0006, rule 4).
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  test('the service worker is served and never cached', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.ok()).toBe(true);
    // A cached service worker means a deployment can take hours to reach an
    // installed app (spec 0009, rule 15).
    expect(response.headers()['cache-control']).toContain('no-store');

    const body = await response.text();
    expect(body).toContain('showNotification');
    expect(body).toContain('notificationclick');
  });

  test('the icons the manifest promises actually exist', async ({ request }) => {
    for (const size of [192, 512, 1024]) {
      const response = await request.get(`/icons/icon-${size}.png`);
      expect(response.ok(), `icon-${size}.png is missing`).toBe(true);
      expect(response.headers()['content-type']).toContain('image/png');
    }
  });

  test('health reports the commit, which is what proves a deploy restarted', async ({
    request,
  }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { status: string; commit: string; players: number };
    expect(body.status).toBe('ok');
    expect(body.commit).toBe('e2e');
    expect(body.players).toBeGreaterThan(0);
  });

  test('an unknown route and an unknown player both 404 politely', async ({ page }) => {
    await login(page, 'antoine');

    await page.goto('/players/gandalf');
    await expect(page.getByText('Introuvable')).toBeVisible();

    await page.goto('/matches/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText('Introuvable')).toBeVisible();
  });
});
