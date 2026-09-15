import { AdjustPointsForm } from '@/components/admin/AdjustPointsForm';
import { AdminMatchControls } from '@/components/admin/AdminMatchControls';
import { DisputeResolver } from '@/components/admin/DisputeResolver';
import { MatchSummaryCard } from '@/components/matches/MatchSummaryCard';
import { ButtonLink } from '@/components/ui/Button';
import { Card, SectionTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAdmin } from '@/lib/auth/guards';
import { listDisputedMatches, listNonTerminalMatches } from '@/lib/queries/matches';
import { getRoster } from '@/lib/queries/roster';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await requireAdmin('/admin');
  const [disputes, running, roster] = await Promise.all([
    listDisputedMatches(),
    listNonTerminalMatches(),
    getRoster(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration"
        subtitle="Chaque action ici apparaît dans le journal public."
        action={
          <ButtonLink href="/admin/games" size="sm" variant="secondary">
            Gérer les jeux
          </ButtonLink>
        }
      />

      <section>
        <SectionTitle>Résultats contestés</SectionTitle>
        {disputes.length === 0 ? (
          <EmptyState illustration="⚖️" title="Aucune contestation">
            Les parties contestées atterrissent ici jusqu’à ce qu’un admin tranche.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {disputes.map((match, index) => (
              <li key={match.id} className="space-y-2">
                <MatchSummaryCard match={match} reveal={index} />
                <DisputeResolver
                  matchId={match.id}
                  sides={match.sides.map((side) => ({
                    sideIndex: side.sideIndex,
                    label: side.label,
                    score: side.score,
                  }))}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Parties en cours</SectionTitle>
        {running.length === 0 ? (
          <EmptyState illustration="⏳" title="Rien en cours" />
        ) : (
          <ul className="space-y-3">
            {running.map((match, index) => (
              <li key={match.id} className="space-y-2">
                <MatchSummaryCard match={match} reveal={index} />
                <AdminMatchControls matchId={match.id} status={match.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Ajuster des points</SectionTitle>
        <Card>
          <p className="mb-3 text-sm text-muted">
            Pour les jeux inventés sur place et jamais modélisés. L’ajustement apparaît dans
            le profil public du joueur, avec ton nom et ton motif — il n’y a pas
            d’ajustement discret.
          </p>
          <AdjustPointsForm roster={roster} />
        </Card>
      </section>
    </div>
  );
}
