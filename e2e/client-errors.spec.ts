import { expect, test, type Browser, type Page } from '@playwright/test';

import { PLAYERS, login } from './helpers/auth';
import { clientErrorGroups, resetVolatileState, waitForClientErrors } from './helpers/db';

/**
 * Client error reporting (spec 0011).
 *
 * The one suite that has to run in a real browser by definition: the thing
 * being tested is whether a failure *in a browser* reaches the server. A unit
 * test cannot have an unhandled promise rejection in Safari.
 */
async function asPlayer(browser: Browser, player: keyof typeof PLAYERS): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, player);
  return page;
}

test.beforeEach(() => resetVolatileState());

test.describe('Reporting browser failures', { tag: '@spec-0011' }, () => {
  test('a render crash shows a recovery screen and is reported', async ({ browser }) => {
    const antoine = await asPlayer(browser, 'antoine');
    await antoine.goto('/e2e-crash');

    // The guest gets a recovery screen, not the default Next.js error page…
    await expect(antoine.getByRole('heading', { name: 'Cet écran a planté' })).toBeVisible();
    await expect(antoine.getByRole('button', { name: 'Réessayer' })).toBeVisible();
    await expect(antoine.getByRole('link', { name: 'Retour au classement' })).toBeVisible();
    // …and never a raw stack trace (spec 0011, rule 14).
    await expect(antoine.getByText(/at .*\.js:/)).toHaveCount(0);

    const groups = await waitForClientErrors(1);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.kind).toBe('render');
    expect(group.path).toBe('/e2e-crash');
    expect(group.occurrences).toBe(1);
    // The three things actually asked for: a stack, the user, the browser.
    expect(group.stack ?? '').not.toBe('');
    expect(group.last_user_id).toBe(PLAYERS.antoine.id);
    expect(group.last_browser).toMatch(/Chrome|Safari|Firefox|Edge/);
    expect(group.app_commit).toBe('e2e');
    expect(group.viewport).toMatch(/^\d+x\d+$/);
  });

  test('it appears on the admin screen with the user and the browser', async ({ browser }) => {
    const antoine = await asPlayer(browser, 'antoine');
    await antoine.goto('/e2e-crash');
    await waitForClientErrors(1);

    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin/errors');

    const entry = admin.getByTestId('client-error').first();
    await expect(entry).toHaveAttribute('data-kind', 'render');
    await expect(entry).toContainText('Écran planté');
    await expect(entry).toContainText('/e2e-crash');
    await expect(entry).toContainText(PLAYERS.antoine.name);
    await expect(entry).toContainText(/Chrome|Safari|Firefox|Edge/);

    // The trace is there, behind a disclosure — the one place a raw stack
    // belongs (rules 14 and 17).
    await entry.getByText('Trace d’appel').click();
    await expect(entry.locator('pre')).toContainText('Error');
  });

  test('an uncaught exception is reported', async ({ browser }) => {
    const page = await asPlayer(browser, 'baptiste');
    // Thrown from a timer, so it reaches window.onerror as a genuine uncaught
    // error rather than being returned to the test runner.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('Explosion volontaire hors rendu');
      }, 0);
    });

    const groups = await waitForClientErrors(1);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('unhandled');
    expect(groups[0]!.message).toContain('Explosion volontaire');
    expect(groups[0]!.last_user_id).toBe(PLAYERS.baptiste.id);
  });

  test('an unhandled promise rejection is reported', async ({ browser }) => {
    const page = await asPlayer(browser, 'clement');
    await page.evaluate(() => {
      void Promise.reject(new Error('Promesse rejetée volontairement'));
    });

    const groups = await waitForClientErrors(1);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('rejection');
    expect(groups[0]!.message).toContain('Promesse rejetée');
  });

  test('the same failure twice is one group with a count of two', async ({ browser }) => {
    const page = await asPlayer(browser, 'hugo');

    // Two page loads, because the client sends each fingerprint at most once
    // per load (rule 12). Two reports in one load would be deduplicated in the
    // browser and never reach the server — which is the point of that rule.
    await page.goto('/e2e-crash');
    await waitForClientErrors(1);
    await page.goto('/e2e-crash');

    const deadline = Date.now() + 10_000;
    let groups = clientErrorGroups();
    while (groups[0]?.occurrences !== 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      groups = clientErrorGroups();
    }

    expect(groups).toHaveLength(1);
    expect(groups[0]!.occurrences).toBe(2);
  });

  test('two different failures are two groups', async ({ browser }) => {
    const page = await asPlayer(browser, 'lucas');
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('Première panne distincte');
      }, 0);
    });
    await waitForClientErrors(1);
    await page.evaluate(() => {
      void Promise.reject(new Error('Seconde panne distincte'));
    });

    const groups = await waitForClientErrors(2);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.kind))).toEqual(new Set(['unhandled', 'rejection']));
  });

  test('a report with no session is stored with no user', async ({ page }) => {
    // A broken session is one of the things this is meant to catch, so an
    // anonymous report must be accepted (rule 5).
    await page.goto('/');
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('Panne sur l’écran de connexion');
      }, 0);
    });

    const groups = await waitForClientErrors(1);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.last_user_id).toBeNull();
    expect(groups[0]!.path).toBe('/');
  });
});

test.describe('The reporting endpoint defends itself', { tag: '@spec-0011' }, () => {
  test('it rejects an over-long stack rather than truncating it', async ({ request }) => {
    const response = await request.post('/api/client-errors', {
      data: {
        kind: 'unhandled',
        message: 'trop gros',
        stack: 'x'.repeat(8_001),
        path: '/leaderboard',
      },
    });
    expect(response.status()).toBe(400);
    expect(clientErrorGroups()).toHaveLength(0);
  });

  test('it rejects a full URL where a route belongs', async ({ request }) => {
    const response = await request.post('/api/client-errors', {
      data: {
        kind: 'unhandled',
        message: 'mauvais chemin',
        path: 'https://evg.example.com/leaderboard?next=/admin',
      },
    });
    expect(response.status()).toBe(400);
  });

  test('it rejects an unknown kind and a malformed body', async ({ request }) => {
    expect(
      (
        await request.post('/api/client-errors', {
          data: { kind: 'explosion', message: 'x', path: '/' },
        })
      ).status(),
    ).toBe(400);

    expect(
      (
        await request.post('/api/client-errors', {
          data: 'pas du json',
          headers: { 'content-type': 'text/plain' },
        })
      ).status(),
    ).toBe(400);
  });

  test('it accepts the text/plain body that sendBeacon sends', async ({ request }) => {
    // sendBeacon sends text/plain unless given a typed Blob, so the handler
    // must not trust the content type.
    const response = await request.post('/api/client-errors', {
      headers: { 'content-type': 'text/plain' },
      data: JSON.stringify({
        kind: 'sw',
        message: 'Service worker en panne',
        path: '/leaderboard',
      }),
    });
    expect(response.status()).toBe(204);

    const groups = await waitForClientErrors(1);
    expect(groups[0]!.kind).toBe('sw');
  });

  test('it ignores a user id supplied by the client', async ({ browser }) => {
    // The identity comes from the cookie, never from the body (rule 3).
    const page = await asPlayer(browser, 'romain');
    const status = await page.evaluate(async () => {
      const response = await fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'unhandled',
          message: 'usurpation',
          path: '/leaderboard',
          lastUserId: 'quentin',
          userId: 'quentin',
        }),
      });
      return response.status;
    });
    expect(status).toBe(204);

    const groups = await waitForClientErrors(1);
    expect(groups[0]!.last_user_id).toBe(PLAYERS.romain.id);
  });
});

test.describe('The admin screen', { tag: '@spec-0011' }, () => {
  test('a plain player cannot reach it', async ({ browser }) => {
    const player = await asPlayer(browser, 'antoine');
    await player.goto('/admin/errors');
    await expect(player.getByRole('heading', { name: 'Classement' })).toBeVisible();
    await expect(player.getByRole('heading', { name: 'Erreurs navigateur' })).toHaveCount(0);
  });

  test('resolving hides a group, and reopening brings it back', async ({ browser }) => {
    const antoine = await asPlayer(browser, 'antoine');
    await antoine.goto('/e2e-crash');
    await waitForClientErrors(1);

    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin/errors');
    await expect(admin.getByTestId('client-error')).toHaveCount(1);

    await admin.getByRole('button', { name: 'Marquer comme traitée' }).click();
    await expect(admin.getByText('Aucune erreur ouverte')).toBeVisible();

    await admin.getByRole('link', { name: 'Tout, traitées incluses' }).click();
    await expect(admin.getByTestId('client-error')).toHaveCount(1);
    await expect(admin.getByText('Traitée')).toBeVisible();

    await admin.getByRole('button', { name: 'Rouvrir' }).click();
    await admin.goto('/admin/errors');
    await expect(admin.getByTestId('client-error')).toHaveCount(1);
  });

  test('an empty screen says so', async ({ browser }) => {
    const admin = await asPlayer(browser, 'quentin');
    await admin.goto('/admin/errors');
    await expect(admin.getByText('Aucune erreur ouverte')).toBeVisible();
  });
});
