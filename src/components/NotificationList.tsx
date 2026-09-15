'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { markAllNotificationsRead, markNotificationRead } from '@/lib/actions/push';
import type { NotificationRow as Row } from '@/db/schema';
import { relativeTime } from '@/lib/format';

import { reveal } from './ui/reveal';

import { Button } from './ui/Button';

export function NotificationRow({
  notification,
  reveal: revealIndex,
}: {
  notification: Row;
  /** Position in its list, for the screen's single entrance sequence. */
  reveal?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = notification.readAt === null;

  // Opening marks it read and navigates to where the player can act
  // (spec 0006, rule 10).
  const open = () => {
    startTransition(async () => {
      if (unread) await markNotificationRead(notification.id);
      router.push(notification.url);
    });
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={pending}
      className={[
        'sticker tap-target flex w-full items-start gap-3 p-3 text-left transition-colors',
        unread ? 'sticker-coral' : 'hover:bg-bg',
        revealIndex === undefined ? '' : reveal(revealIndex).className,
      ].join(' ')}
      style={revealIndex === undefined ? undefined : reveal(revealIndex).style}
    >
      {unread ? (
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-coral" aria-label="Non lu" />
      ) : (
        <span className="mt-1.5 size-2 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{notification.title}</span>
        <span className="block text-sm text-muted">{notification.body}</span>
        <span className="mt-0.5 block text-xs text-faint">
          {relativeTime(notification.createdAt)}
        </span>
      </span>
    </button>
  );
}

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markAllNotificationsRead();
          router.refresh();
        })
      }
    >
      Tout marquer comme lu
    </Button>
  );
}
