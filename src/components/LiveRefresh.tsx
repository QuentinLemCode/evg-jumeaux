'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Keeps screens showing other people's actions current (spec 0009, rules
 * 16-17): a poll while visible, plus an immediate refresh when the tab regains
 * focus, which is the common case when someone unlocks their phone after a
 * push.
 *
 * `router.refresh()` re-runs the server components and reconciles — it keeps
 * scroll position and typed input, which a reload would not.
 */
export function LiveRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };

    const timer = window.setInterval(refresh, intervalMs);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router, intervalMs]);

  return null;
}
