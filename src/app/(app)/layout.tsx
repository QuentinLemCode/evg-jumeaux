import Link from 'next/link';

import { AppNav } from '@/components/nav/AppNav';
import { PushPrompt } from '@/components/PushPrompt';
import { Avatar } from '@/components/ui/Avatar';
import { requireUser } from '@/lib/auth/guards';
import { env } from '@/lib/env';
import { unreadCount } from '@/lib/queries/notifications';

/**
 * The authenticated shell (spec 0009, rules 2-3). Everything inside it is
 * behind `requireUser`, so no page in this group has to remember to check.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unread = await unreadCount(user.id);

  return (
    <div className="min-h-dvh md:pl-56">
      <AppNav isAdmin={user.role === 'admin'} unreadCount={unread} />

      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/leaderboard" className="display text-lg font-black tracking-tight md:hidden">
            EVG des Jumeaux
          </Link>
          <Link
            href={`/players/${user.id}`}
            className="tap-target ml-auto flex items-center gap-2 rounded-full border border-border bg-surface px-2 py-1"
          >
            <Avatar emoji={user.avatar} size="sm" />
            <span className="pr-1 text-sm font-medium">{user.name}</span>
          </Link>
        </div>
      </header>

      {/* pb-24 clears the fixed bottom bar; nothing is hidden under it. */}
      <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-24 md:pb-10">
        <PushPrompt vapidPublicKey={env().NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
        {children}
      </main>
    </div>
  );
}
