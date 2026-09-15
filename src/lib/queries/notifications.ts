/**
 * The in-app inbox (spec 0006, rule 10).
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { notifications, type NotificationRow } from '@/db/schema';

export async function listInbox(userId: string, limit = 50): Promise<NotificationRow[]> {
  // Unread first, then newest — the thing you have not seen is the thing you
  // came here for.
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(sql`${notifications.readAt} is not null`, desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(rows[0]?.count ?? 0);
}
