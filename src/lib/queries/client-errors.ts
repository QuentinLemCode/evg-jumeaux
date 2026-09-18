/**
 * Reading the grouped browser failures (spec 0011, rules 16-18).
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { clientErrors, users, type ClientErrorRow } from '@/db/schema';

export type ClientErrorGroup = ClientErrorRow & {
  lastUserName: string | null;
};

export async function listClientErrors(
  options: { includeResolved?: boolean; limit?: number } = {},
): Promise<ClientErrorGroup[]> {
  const rows = await db
    .select({ error: clientErrors, lastUserName: users.name })
    .from(clientErrors)
    .leftJoin(users, eq(users.id, clientErrors.lastUserId))
    .where(options.includeResolved ? undefined : isNull(clientErrors.resolvedAt))
    .orderBy(desc(clientErrors.lastSeenAt))
    .limit(options.limit ?? 100);

  return rows.map((row) => ({ ...row.error, lastUserName: row.lastUserName }));
}

export async function countOpenClientErrors(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(clientErrors)
    .where(isNull(clientErrors.resolvedAt));
  return Number(rows[0]?.count ?? 0);
}

/**
 * Groups the watcher has not reported yet (spec 0011, rule 21). One alert per
 * group: a recurrence increments the counter and must stay quiet, which is why
 * the endpoint never clears `alertedAt`.
 */
export async function listUnalertedClientErrors(): Promise<ClientErrorGroup[]> {
  const rows = await db
    .select({ error: clientErrors, lastUserName: users.name })
    .from(clientErrors)
    .leftJoin(users, eq(users.id, clientErrors.lastUserId))
    .where(and(isNull(clientErrors.alertedAt), isNull(clientErrors.resolvedAt)))
    .orderBy(desc(clientErrors.lastSeenAt))
    .limit(10);

  return rows.map((row) => ({ ...row.error, lastUserName: row.lastUserName }));
}
