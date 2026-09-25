import { AdjustPointsForm } from '@/components/admin/AdjustPointsForm';
import { AdminMatchControls } from '@/components/admin/AdminMatchControls';
import { DisputeResolver } from '@/components/admin/DisputeResolver';
import { ResetTournamentControls } from '@/components/admin/ResetTournamentControls';
import { ScarfTheftForm } from '@/components/admin/ScarfTheftForm';
import { MatchSummaryCard } from '@/components/matches/MatchSummaryCard';
import { ButtonLink } from '@/components/ui/Button';
import { Card, SectionTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAdmin } from '@/lib/auth/guards';
import { countOpenClientErrors } from '@/lib/queries/client-errors';
import { listDisputedMatches, listNonTerminalMatches } from '@/lib/queries/matches';
import { getRoster } from '@/lib/queries/roster';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await requireAdmin('/admin');
  const [disputes, running, roster, openErrors] = await Promise.all([
    listDisputedMatches(),
    listNonTerminalMatches(),
    getRoster(),
    countOpenClientErrors(),
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

      {/* Browser failures are invisible unless somebody looks, so the count
          sits on the screen an admin already opens (spec 0011). */}
      <Card accent={openErrors > 0 ? 'coral' : undefined} quiet={openErrors === 0}>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm">
            <span className="display block font-bold">Erreurs navigateur</span>
            <span className="block text-xs text-muted">
              {openErrors === 0
                ? 'Rien de signalé chez les joueurs.'
                : `${openErrors} cause${openErrors > 1 ? 's' : ''} ouverte${openErrors > 1 ? 's' : ''}.`}
            </span>
          </span>
          <ButtonLink href="/admin/errors" size="sm" variant="secondary">
            Voir
          </ButtonLink>
        </div>
      </Card>

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
                {/* The complaint itself. An admin asked to arbitrate without
                    seeing it is guessing (spec 0008, rule 2). */}
                {match.disputeReason ? (
                  <p className="sticker sticker-tangerine px-3 py-2 text-sm text-ink">
                    <span className="display mb-0.5 block text-[11px] font-bold tracking-wide text-muted uppercase">
                      Contestation
                    </span>
                    {match.disputeReason}
                  </p>
                ) : null}
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
        <SectionTitle>Vol de foulard</SectionTitle>
        <Card>
          <p className="mb-3 text-sm text-muted">
            Enregistre un vol de foulard réussi. Par défaut, rapporte 2 points au voleur.
            L’action apparaît dans le profil du joueur et dans le journal public.
          </p>
          <ScarfTheftForm roster={roster} />
        </Card>
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

      <section>
        <SectionTitle>Lancement officiel du jeu</SectionTitle>
        <Card accent="coral">
          <p className="mb-1 text-sm font-bold text-ink">
            Remise à zéro avant le début
          </p>
          <p className="mb-4 text-xs text-muted">
            Efface tous les scores, l’historique des parties et réinitialise les équipes pour
            commencer le jeu sur des bases neuves. Les comptes et jeux configurés sont conservés.
          </p>
          <ResetTournamentControls />
        </Card>
      </section>
    </div>
  );
}

