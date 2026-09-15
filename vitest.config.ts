import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Domain logic only: pure functions, no database, no server. Fast enough
    // that the code agent has no excuse to skip the gate.
    include: ['src/**/*.test.ts'],
    // The integration suite needs a real database and belongs in CI, not in
    // the fast gate the code agent runs on every change.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
