import { GameManager } from '@/components/admin/GameManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireAdmin } from '@/lib/auth/guards';
import { listGames } from '@/lib/queries/games';

export const dynamic = 'force-dynamic';

export default async function AdminGamesPage() {
  await requireAdmin('/admin/games');
  const games = await listGames();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Jeux"
        subtitle="Modifier les points n’affecte que les parties créées après."
      />
      <GameManager
        games={games.map((game) => ({
          id: game.id,
          name: game.name,
          description: game.description,
          icon: game.icon,
          mode: game.mode,
          sidesCount: game.sidesCount,
          playersPerSide: game.playersPerSide,
          pointsPerWin: game.pointsPerWin,
          marginBonusEnabled: game.marginBonusEnabled,
          marginBonusPerPoint: game.marginBonusPerPoint,
          marginBonusCap: game.marginBonusCap,
          requiresScore: game.requiresScore,
          isActive: game.isActive,
          matchCount: game.matchCount,
        }))}
      />
    </div>
  );
}
