/**
 * Deletes the local database file and re-creates it from the migrations and
 * the seed. Development only: it refuses to run when NODE_ENV=production,
 * because the production database holds results people entered by hand.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

if (process.env.NODE_ENV === 'production') {
  console.error('db:reset is refused in production — it would destroy results');
  process.exit(1);
}

const path = process.env.DATABASE_PATH ?? './data/evg.db';
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${path}${suffix}`;
  if (existsSync(file)) rmSync(file);
}
console.log(`removed ${path}`);

const run = (script: string) =>
  execFileSync('npm', ['run', script], { stdio: 'inherit' });
run('db:migrate');
run('db:seed');
