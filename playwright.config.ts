import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (AGENTS.md §10).
 *
 * They run against a PRODUCTION build on a throwaway SQLite file, because a
 * dev-server pass proves the dev server works. `scripts/e2e-prepare.mjs`
 * builds if needed, deletes the database, migrates and seeds — so the suite
 * starts from the same known roster every time.
 *
 * `workers: 1` is deliberate and not laziness: every test shares one server
 * process, one SQLite file and one in-memory login rate-limiter, so parallel
 * tests would interfere through all three. The suite is small enough that
 * serial is fast, and a flaky E2E suite is worse than a slow one.
 */
const PORT = 3210;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // A phone is the reference viewport (spec 0009): testing at desktop width
  // would miss the bottom navigation, which is where every journey starts.
  use: {
    baseURL: BASE_URL,
    ...devices['iPhone 13'],
    // Chromium rather than WebKit's mobile default: it is what CI has, and the
    // app's one browser-specific path (iOS install) is feature-detected and
    // covered by unit tests.
    defaultBrowserType: 'chromium',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
      // Desktop is a progressive enhancement (spec 0009), so it only needs to
      // prove the shell ADAPTS — not every journey again, and not the served
      // manifest a second time.
      testMatch: /shell\.spec\.ts/,
    },
  ],
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: './.e2e/results',

  webServer: {
    command: 'node scripts/e2e-prepare.mjs && npx next start -p 3210',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      DATABASE_PATH: './.e2e/evg.db',
      AUTH_SECRET: 'e2e-secret-that-is-at-least-32-characters',
      // The seed refuses the shared development PIN in production, which is
      // exactly the guard we want in real life and exactly what we must opt
      // out of here (spec 0002).
      ALLOW_DEV_PINS: '1',
      SITE_DOMAIN: `127.0.0.1:${PORT}`,
      GIT_COMMIT: 'e2e',
    },
  },
});
