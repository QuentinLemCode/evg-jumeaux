/**
 * Prepares the end-to-end environment: a production build if one is missing,
 * then a throwaway database migrated and seeded from scratch.
 *
 * Run by playwright.config.ts as part of the webServer command, so the
 * ordering is guaranteed — a `globalSetup` would race the server start.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';

const DB = process.env.DATABASE_PATH ?? './.e2e/evg.db';

const run = (script) =>
  execFileSync('npm', ['run', '--silent', script], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_PATH: DB },
  });

if (!existsSync('.next/BUILD_ID')) {
  console.log('e2e: no production build found, building…');
  execFileSync('npm', ['run', '--silent', 'build'], { stdio: 'inherit' });
}

mkdirSync('.e2e', { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${DB}${suffix}`;
  if (existsSync(file)) rmSync(file);
}
console.log(`e2e: fresh database at ${DB}`);

run('db:migrate');
run('db:seed');
console.log('e2e: ready');
