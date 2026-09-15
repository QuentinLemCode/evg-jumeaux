import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The integration suite: a real SQLite database, real migrations, real
 * queries. Run by CI (`npm run test:integration`), not by the local gate —
 * see AGENTS.md §4.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    // One file at a time: the suites share a database path per file and must
    // not race each other.
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
