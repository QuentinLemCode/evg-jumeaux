import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { users } from '@/db/schema';

/**
 * The deploy gate (`scripts/agent/deploy.sh` polls this). It must actually
 * touch the database: an app that boots but cannot read its own schema is not
 * healthy, and reporting `ok` for it would make every deploy look successful.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const commit = process.env.GIT_COMMIT ?? 'dev';

  try {
    const rows = await db.select({ count: sql<number>`count(*)` }).from(users);
    return Response.json(
      {
        status: 'ok',
        migrations: 'current',
        commit,
        players: Number(rows[0]?.count ?? 0),
        at: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        migrations: 'unknown',
        commit,
        error: error instanceof Error ? error.message : 'unreadable database',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
