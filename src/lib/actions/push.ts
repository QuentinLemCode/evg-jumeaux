'use server';

/**
 * Push subscription management and inbox reads (spec 0006).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { notifications, pushSubscriptions } from '@/db/schema';
import { requireUserAction } from '@/lib/auth/guards';

import { err, guarded, ok, type ActionResult } from './result';

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(300).optional(),
});

export async function savePushSubscription(
  input: z.input<typeof subscriptionSchema>,
): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) return err('Abonnement invalide');

    const now = Date.now();
    // Subscribing twice from the same device must not create two rows: the
    // endpoint is the device's identity (spec 0006, rule 5 and failure table).
    await db
      .insert(pushSubscriptions)
      .values({
        id: crypto.randomUUID(),
        userId: me.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: parsed.data.userAgent ?? null,
        failures: 0,
        createdAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: me.id,
          p256dh: parsed.data.keys.p256dh,
          auth: parsed.data.keys.auth,
          failures: 0,
          lastSeenAt: now,
        },
      });

    return ok();
  });
}

export async function deletePushSubscription(endpoint: string): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, endpoint),
          // Scoped to the caller: a player can only remove their own devices.
          eq(pushSubscriptions.userId, me.id),
        ),
      );
    return ok();
  });
}

export async function markNotificationRead(notificationId: string): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    await db
      .update(notifications)
      .set({ readAt: Date.now() })
      .where(
        and(eq(notifications.id, notificationId), eq(notifications.userId, me.id)),
      );
    revalidatePath('/notifications');
    return ok();
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  return guarded(async () => {
    const me = await requireUserAction();
    await db
      .update(notifications)
      .set({ readAt: Date.now() })
      .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)));
    revalidatePath('/notifications');
    return ok();
  });
}
