'use client';

import { useEffect } from 'react';

import { reportClientError } from '@/lib/report-client-error';

import './globals.css';

/**
 * The last resort: a failure in the root layout itself (spec 0011, rule 14).
 *
 * Next.js replaces the entire document here, so this file owns `<html>` and
 * `<body>` and has to import the stylesheet itself — the root layout that
 * normally loads it is exactly what failed.
 *
 * Deliberately minimal: whatever broke may be the design system, so this
 * screen leans on almost nothing.
 */
export default function GlobalError({
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
    <html lang="fr">
      <body className="flex min-h-dvh items-center justify-center bg-bg px-6 text-center text-ink">
        <div className="w-full max-w-sm">
          {/* design-lint-allow:emoji-icon — decorative illustration, not an icon */}
          <p className="text-5xl" aria-hidden>
            🧯
          </p>
          <h1 className="display mt-3 text-xl leading-tight font-black">
            L’application a planté
          </h1>
          <p className="mt-2 text-sm leading-snug text-muted">
            Le problème a été signalé automatiquement. Recharge la page.
          </p>
          <button
            type="button"
            onClick={reset}
            className="sticker-button tap-target mt-5 w-full bg-coral px-4 py-3 text-bg"
          >
            Recharger
          </button>
          {error.digest ? (
            <p className="mt-4 text-[11px] text-faint">Référence : {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
