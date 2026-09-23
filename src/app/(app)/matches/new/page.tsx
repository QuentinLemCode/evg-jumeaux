import { notFound, redirect } from 'next/navigation';

import { ClashForm } from '@/components/matches/ClashForm';
import { NewMatchForm } from '@/components/matches/NewMatchForm';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireUser } from '@/lib/auth/guards';
import { getGameById } from '@/lib/queries/games';
import { getRosterWithAvailability, isBusy } from '@/lib/queries/roster';
import { getClashLineup } from '@/lib/queries/teams';

export const dynamic = 'force-dynamic';

export default async function NewMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const { game: gameId } = await searchParams;
  const me = await requireUser('/games');
  if (!gameId) redirect('/games');

  const game = await getGameById(gameId);
  if (!game) notFound();
  if (!game.isActive) redirect('/games');

  const busyMatchId = await isBusy(me.id);
  if (busyMatchId) redirect(`/matches/${busyMatchId}`);

  // A clash commits every guest at once, so an admin calls it
  // (spec 0017, Authorisation).
  const isClash = game.mode === 'clash';
  if (isClash && me.role !== 'admin') redirect('/games');
  const clashSides = isClash ? await getClashLineup(me.id) : null;

  const roster = isClash ? [] : await getRosterWithAvailability();

  return (
    <div className="space-y-4">
      <PageHeader
        title={isClash ? 'Le match des deux équipes' : 'Nouvelle partie'}
        subtitle={
          isClash ? 'Les deux équipes au complet.' : 'Choisis tes adversaires.'
        }
      />

      <Card>
        <div className="flex items-start gap-3">
          <span className="text-3xl" aria-hidden>
            {game.icon}
          </span>
          <div>
            <h1 className="text-lg font-bold">{game.name}</h1>
            <p className="text-sm text-muted">
              {/* «Camp» for a side of a match; «équipe» is one of the
                  weekend's two teams (spec 0017, rule 29). */}
              {game.mode === 'duel'
                ? `${game.sidesCount} joueurs, chacun pour soi`
                : game.mode === 'clash'
                  ? 'Les deux équipes au complet'
                  : `${game.sidesCount} camps de ${game.playersPerSide}`}{' '}
              · {game.pointsPerWin} pts au vainqueur
              {game.marginBonusEnabled
                ? ` · bonus +${game.marginBonusPerPoint} par point d’écart${
                    game.marginBonusCap ? ` (max ${game.marginBonusCap})` : ''
                  }`
                : ''}
            </p>
          </div>
        </div>
      </Card>

      {isClash ? (
        clashSides ? (
          <ClashForm gameId={game.id} sides={clashSides} />
        ) : (
          <EmptyState illustration="🏳️" title="Les équipes ne sont pas prêtes">
            Un match d’équipes oppose les deux équipes au complet, et tu dois être
            dans l’une des deux.
          </EmptyState>
        )
      ) : (
        <NewMatchForm
          game={{
            id: game.id,
            name: game.name,
            // Narrowed by `isClash` above: a clash never reaches this form.
            mode: game.mode === 'team' ? 'team' : 'duel',
            sidesCount: game.sidesCount,
            playersPerSide: game.playersPerSide,
          }}
          me={{ id: me.id, name: me.name, avatar: me.avatar }}
          roster={roster}
        />
      )}
    </div>
  );
}
