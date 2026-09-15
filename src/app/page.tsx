import { redirect } from 'next/navigation';

import { IosInstallHint } from '@/components/IosInstallHint';
import { LoginForm } from '@/components/LoginForm';
import { getCurrentUser } from '@/lib/auth/guards';
import { getRoster } from '@/lib/queries/roster';

/**
 * The landing page is the login screen and nothing else (spec 0001, rule 1).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(next && next.startsWith('/') ? next : '/leaderboard');

  const roster = await getRoster();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <header className="mb-8 text-center">
        {/* design-lint-allow:emoji-icon — the hero illustration, not an icon */}
        <p className="text-5xl" aria-hidden>
          🥂
        </p>
        <h1 className="mt-3 text-2xl font-bold">EVG des Jumeaux</h1>
        <p className="mt-1 text-sm text-muted">
          Choisis ton prénom et entre ton code à 6 chiffres.
        </p>
      </header>

      {/* Before the form, not after: the installed iOS app has its own
          session (spec 0006, rule 2b). */}
      <IosInstallHint />

      <LoginForm roster={roster} next={next ?? null} />

      <p className="mt-8 text-center text-xs text-faint">
        Tu restes connecté 4 jours. Pas de code&nbsp;? Demande à un admin.
      </p>
    </main>
  );
}
