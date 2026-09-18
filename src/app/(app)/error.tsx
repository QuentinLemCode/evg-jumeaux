'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { reportClientError } from '@/lib/report-client-error';

/**
 * The recovery screen for a render failure inside the app shell (spec 0011,
 * rules 14-15).
 *
 * It reports BEFORE it paints, so a guest who closes the tab straight away is
 * still counted. And it never shows the stack trace: a guest can act on none
 * of it, and it makes the app look dead rather than merely broken.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError('render', error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center">
      <Card accent="coral" className="w-full max-w-sm text-center">
        {/* design-lint-allow:emoji-icon — decorative illustration, not an icon */}
        <p className="text-5xl" aria-hidden>
          🙃
        </p>
        <h1 className="display mt-3 text-xl leading-tight font-black">Cet écran a planté</h1>
        <p className="mt-2 text-sm leading-snug text-muted">
          Rien n’est perdu : les parties et les points sont en sécurité. Réessaie, ça passe
          souvent du premier coup.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <Button full onClick={reset}>
            Réessayer
          </Button>
          <Link
            href="/leaderboard"
            className="tap-target display flex items-center justify-center text-sm font-bold text-muted"
          >
            Retour au classement
          </Link>
        </div>

        {/* The digest is the one handle an admin can use to match this to the
            server log, and it is meaningless to anyone else. */}
        {error.digest ? (
          <p className="mt-4 text-[11px] text-faint">Référence : {error.digest}</p>
        ) : null}
      </Card>
    </div>
  );
}
