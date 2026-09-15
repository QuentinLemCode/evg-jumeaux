'use client';

import { useEffect, useState } from 'react';

import { countdown } from '@/lib/format';

/**
 * Ticks client-side every second (spec 0009, rule 18) — a five-minute deadline
 * needs a visible clock, and polling the server once a second for it would be
 * absurd.
 */
export function Countdown({
  deadline,
  onExpired,
}: {
  deadline: number;
  onExpired?: () => void;
}) {
  const [remaining, setRemaining] = useState(() => deadline - Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = deadline - Date.now();
      setRemaining(next);
      if (next <= 0) {
        window.clearInterval(timer);
        onExpired?.();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, onExpired]);

  const expired = remaining <= 0;

  return (
    <span
      className={[
        'display font-bold tabular-nums',
        expired ? 'text-coral' : remaining < 60_000 ? 'text-tangerine' : 'text-text',
      ].join(' ')}
    >
      {expired ? 'expirée' : countdown(remaining)}
    </span>
  );
}
