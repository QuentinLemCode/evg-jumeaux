import Link from 'next/link';

import { ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { reveal } from '@/components/ui/reveal';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireUser } from '@/lib/auth/guards';
import { listGames } from '@/lib/queries/games';
import { isBusy } from '@/lib/queries/roster';

export const dynamic = 'force-dynamic';

export default async function GamesPage() {
  const me = await requireUser('/games');
  const [allGames, busyMatchId] = await Promise.all([listGames(), isBusy(me.id)]);
  const active = allGames.filter((game) => game.isActive);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Choisis un jeu"
        subtitle="Le gagnant saisit le score, le perdant valide."
        action={
          me.role === 'admin' ? (
            <ButtonLink href="/admin/games" size="sm" variant="secondary">
              Gérer
            </ButtonLink>
          ) : undefined
        }
      />

      <section>

        {busyMatchId ? (
          <Card className="mb-3 border-tangerine/40 bg-tangerine/10">
            <p className="text-sm">
              Tu as déjà une partie en cours.{' '}
              <Link href={`/matches/${busyMatchId}`} className="font-medium underline">
                Va la terminer
              </Link>{' '}
              avant d’en lancer une autre.
            </p>
          </Card>
        ) : null}

        {active.length === 0 ? (
          <EmptyState illustration="🎲" title="Aucun jeu disponible">
            Un admin doit d’abord créer un jeu.
          </EmptyState>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {active.map((game, index) => {
              // A clash runs alongside everything else, so a match in progress
              // does not grey it out for the admin who can call it
              // (spec 0017, rule 6).
              const blocked =
                busyMatchId !== null && !(game.mode === 'clash' && me.role === 'admin');
              return (
              <li key={game.id}>
                <Link
                  href={blocked ? `/matches/${busyMatchId}` : `/matches/new?game=${game.id}`}
                  aria-disabled={blocked}
                  className={[
                    'sticker flex h-full items-start gap-3 transition-colors',
                    blocked ? 'sticker-quiet' : 'hover:bg-bg',
                    reveal(index).className,
                  ].join(' ')}
                  style={reveal(index).style}
                >
                  <span className="text-3xl" aria-hidden>
                    {game.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{game.name}</span>
                    {game.description ? (
                      <span className="mt-0.5 block text-xs text-muted">
                        {game.description}
                      </span>
                    ) : null}
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="coral">{game.pointsPerWin} pts</Badge>
                      <Badge>
                        {game.mode === 'duel'
                          ? '1 contre 1'
                          : game.mode === 'clash'
                            ? 'Les deux équipes'
                            : `2 × ${game.playersPerSide} joueurs`}
                      </Badge>
                      {game.marginBonusEnabled ? (
                        <Badge tone="grape">
                          +{game.marginBonusPerPoint}/écart
                          {game.marginBonusCap ? ` (max ${game.marginBonusCap})` : ''}
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
