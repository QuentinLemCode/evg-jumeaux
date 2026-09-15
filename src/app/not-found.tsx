import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      {/* design-lint-allow:emoji-icon — decorative illustration, not an icon */}
      <p className="text-5xl" aria-hidden>
        🤷
      </p>
      <h1 className="mt-4 text-xl font-bold">Introuvable</h1>
      <p className="mt-2 text-sm text-muted">
        Cette page, cette partie ou ce joueur n’existe pas ou plus.
      </p>
      <Link
        href="/leaderboard"
        className="tap-target mt-6 inline-flex items-center rounded-xl bg-coral px-5 py-3 font-semibold text-bg"
      >
        Retour au classement
      </Link>
    </main>
  );
}
