/**
 * Notification delivery (spec 0006).
 *
 * The inbox row is written first and is the source of truth; the push message
 * is a best-effort delivery channel on top. A dead push service must never
 * prevent a match from progressing (rule 11), so every failure here is
 * swallowed after being logged.
 */
import { eq, sql } from 'drizzle-orm';
import webpush from 'web-push';

import { db } from '@/db';
import { notifications, pushSubscriptions, users } from '@/db/schema';
import { env, pushConfigured } from '@/lib/env';

import { deliveryFor } from './delivery';
import type { NotificationIntent } from './events';

const MAX_FAILURES = 5;

let configured = false;

function configure(): boolean {
  if (!pushConfigured()) return false;
  if (configured) return true;
  const e = env();
  webpush.setVapidDetails(
    e.VAPID_SUBJECT as string,
    e.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
    e.VAPID_PRIVATE_KEY as string,
  );
  configured = true;
  return true;
}

/**
 * Writes the inbox rows, then fans out the push messages. Returns once the
 * inbox is durable; push delivery is awaited too, but its failures are not
 * propagated.
 */
export async function deliver(intents: NotificationIntent[]): Promise<void> {
  if (intents.length === 0) return;
  const now = Date.now();

  await db.insert(notifications).values(
    intents.map((intent) => ({
      id: crypto.randomUUID(),
      userId: intent.userId,
      type: intent.type,
      title: intent.title,
      body: intent.body,
      url: intent.url,
      matchId: intent.matchId,
      readAt: null,
      createdAt: now,
    })),
  );

  if (!configure()) return;

  const byUser = new Map<string, NotificationIntent[]>();
  for (const intent of intents) {
    const list = byUser.get(intent.userId) ?? [];
    list.push(intent);
    byUser.set(intent.userId, list);
  }

  await Promise.all(
    [...byUser.entries()].map(([userId, userIntents]) => pushToUser(userId, userIntents)),
  );
}

async function pushToUser(
  userId: string,
  intents: NotificationIntent[],
): Promise<void> {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  if (subs.length === 0) return;

  await Promise.all(
    subs.flatMap((sub) =>
      intents.map(async (intent) => {
        try {
          const policy = deliveryFor(intent);
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify({
              title: intent.title,
              body: intent.body,
              url: intent.url,
              tag: intent.matchId ?? intent.type,
            }),
            // What a sleeping phone actually experiences (spec 0006, §12-14).
            // Every one of these three is wrong by default.
            {
              TTL: policy.ttlSeconds,
              urgency: policy.urgency,
              ...(policy.topic ? { topic: policy.topic } : {}),
            },
          );
          await db
            .update(pushSubscriptions)
            .set({ failures: 0, lastSeenAt: Date.now() })
            .where(eq(pushSubscriptions.id, sub.id));
        } catch (error) {
          await handlePushFailure(sub.id, error);
        }
      }),
    ),
  );
}

async function handlePushFailure(subscriptionId: string, error: unknown): Promise<void> {
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : undefined;

  // 404/410 mean the browser threw the subscription away: it will never work
  // again, so keeping it only produces noise (spec 0006, rule 6).
  if (statusCode === 404 || statusCode === 410) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
    return;
  }

  const rows = await db
    .update(pushSubscriptions)
    .set({ failures: sql`${pushSubscriptions.failures} + 1` })
    .where(eq(pushSubscriptions.id, subscriptionId))
    .returning({ failures: pushSubscriptions.failures });

  const failures = rows[0]?.failures ?? 0;
  if (failures >= MAX_FAILURES) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
  }
  console.warn(`push: delivery failed (status ${statusCode ?? 'unknown'})`);
}

export async function adminIds(): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  return rows.map((r) => r.id);
}
