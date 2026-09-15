/**
 * Applies pending migrations. Run by `npm run db:migrate`, and by
 * `scripts/agent/deploy.sh` after the database has been backed up.
 */
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { db } from './index';

const folder = './src/db/migrations';

try {
  migrate(db, { migrationsFolder: folder });
  console.log('migrations: up to date');
} catch (error) {
  console.error('migrations: failed');
  console.error(error);
  process.exit(1);
}
