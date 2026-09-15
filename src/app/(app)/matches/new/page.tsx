import { notFound, redirect } from 'next/navigation';

import { NewMatchForm } from '@/components/matches/NewMatchForm';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireUser } from '@/lib/auth/guards';
import { getGameById } from '@/lib/queries/games';
import { getRosterWithAvailability, isBusy } from '@/lib/queries/roster';

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

  const roster = await getRosterWithAvailability();

  return (
    <div className="space-y-4">
      <PageHeader title="Nouvelle partie" subtitle="Choisis tes adversaires." />

      <Card>
        <div className="flex items-start gap-3">
          <span className="text-3xl" aria-hidden>
            {game.icon}
          </span>
          <div>
            <h1 className="text-lg font-bold">{game.name}</h1>
            <p className="text-sm text-muted">
              {game.mode === 'duel'
                ? `${game.sidesCount} joueurs, chacun pour soi`
                : `${game.sidesCount} équipes de ${game.playersPerSide}`}{' '}
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

      <NewMatchForm
        game={{
          id: game.id,
          name: game.name,
          mode: game.mode,
          sidesCount: game.sidesCount,
          playersPerSide: game.playersPerSide,
        }}
        me={{ id: me.id, name: me.name, avatar: me.avatar }}
        roster={roster}
      />
    </div>
  );
}
