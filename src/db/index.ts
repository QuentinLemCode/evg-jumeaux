import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import * as schema from './schema';

type Client = BetterSQLite3Database<typeof schema>;

/**
 * The connection, opened on first use rather than on import.
 *
 * Importing a module must not do I/O: the production build evaluates every
 * route module in several parallel workers, and an eager connection had them
 * racing to create the same SQLite file (SQLITE_BUSY). Lazily is also simply
 * correct — a module that is imported but never queried should not touch the
 * disk.
 *
 * The instance is cached on `globalThis` because Next.js re-evaluates modules
 * on every hot reload in development; without that, each reload would leak a
 * file handle.
 */
const globalForDb = globalThis as unknown as {
  __evgSqlite?: Database.Database;
  __evgDb?: Client;
};

function connect(): Database.Database {
  const path = process.env.DATABASE_PATH ?? './data/evg.db';
  mkdirSync(dirname(path), { recursive: true });
  const connection = new Database(path);
  // WAL lets the background sweep write while a request reads.
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  // Wait rather than fail instantly when the sweep holds the write lock.
  connection.pragma('busy_timeout = 5000');
  return connection;
}

export function getSqlite(): Database.Database {
  if (!globalForDb.__evgSqlite) globalForDb.__evgSqlite = connect();
  return globalForDb.__evgSqlite;
}

function instance(): Client {
  if (!globalForDb.__evgDb) globalForDb.__evgDb = drizzle(getSqlite(), { schema });
  return globalForDb.__evgDb;
}

/**
 * A proxy so that `db.select(...)` connects on first use while every call site
 * keeps using a plain `db` object.
 */
export const db: Client = new Proxy({} as Client, {
  get(_target, property) {
    const client = instance();
    const value = Reflect.get(client as object, property, client as object);
    return typeof value === 'function' ? value.bind(client) : value;
  },
  has(_target, property) {
    return Reflect.has(instance() as object, property);
  },
});

export { schema };
export type Db = Client;
