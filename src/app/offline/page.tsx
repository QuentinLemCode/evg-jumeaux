import { RetryButton } from '@/components/RetryButton';

/**
 * Shown by the service worker when a navigation fails (spec 0009, rule 14).
 * It deliberately shows nothing stale: a leaderboard from twenty minutes ago
 * looks current and is worse than an honest error.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      {/* design-lint-allow:emoji-icon — decorative illustration, not an icon */}
      <p className="text-5xl" aria-hidden>
        📡
      </p>
      <h1 className="mt-4 text-xl font-bold">Pas de connexion</h1>
      <p className="mt-2 text-sm text-muted">
        Impossible de charger les données. Rien n’est perdu — réessaie dès que le réseau
        revient.
      </p>
      <RetryButton />
    </main>
  );
}
