import { notFound } from 'next/navigation';

import { Countdown } from '@/components/Countdown';
import { LiveRefresh } from '@/components/LiveRefresh';
import { MatchActions } from '@/components/matches/MatchActions';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, SectionTitle } from '@/components/ui/Card';
import { PlayerLink } from '@/components/ui/Avatar';
import { PageHeader } from '@/components/ui/PageHeader';
import { Delta, Score } from '@/components/ui/Score';
import { CrownIcon } from '@/components/ui/Icon';
import { requireUser } from '@/lib/auth/guards';
import { POINT_TYPE_LABELS, dateTime } from '@/lib/format';
import { actionsFor, getMatchView } from '@/lib/queries/matches';

export const dynamic = 'force-dynamic';

const INVITATION_LABELS = {
  pending: 'en attente',
  accepted: 'a accepté',
  declined: 'a refusé',
} as const;

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser(`/matches/${id}`);
  const view = await getMatchView(id);
  if (!view) notFound();

  const { match, game, effectiveStatus, sides, awards, teamAwards } = view;
  const permissions = actionsFor(view, me.id);
  const mySide = view.participants.find((p) => p.userId === me.id)?.sideIndex ?? null;

  const timeline: { label: string; at: number | null }[] = [
    { label: 'Partie créée', at: match.createdAt },
    { label: 'Résultat saisi', at: match.reportedAt },
    { label: 'Résultat validé', at: match.settledAt },
  ];

  return (
    <div className="space-y-4">
      <LiveRefresh intervalMs={5000} />

      {/* games.icon is an emoji by design (spec 0003) */}
      <PageHeader
        title={`${game.icon} ${game.name}`}
        action={<StatusBadge status={effectiveStatus} />}
      />

      <Card>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {effectiveStatus === 'pending' ? (
              <p className="mt-1 text-sm text-muted">
                Invitation expire dans <Countdown deadline={match.invitationExpiresAt} />
              </p>
            ) : null}
            {match.cancelReason ? (
              <p className="mt-1 text-sm text-muted">Motif : {match.cancelReason}</p>
            ) : null}
            {match.disputeReason ? (
              <p className="mt-1 text-sm text-coral">
                Contestation : {match.disputeReason}
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <section>
        <SectionTitle>Camps</SectionTitle>
        <ul className="space-y-2">
          {sides.map((side, index) => {
            const won = match.winningSide === side.sideIndex;
            return (
              <li key={side.sideIndex} data-testid="match-side" data-side={side.sideIndex}>
                <Card accent={won ? 'mint' : undefined} reveal={index} revealKind="pop">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium">
                        {won ? <CrownIcon size={16} className="text-mint" /> : null}
                        {side.label}
                        {side.sideIndex === mySide ? (
                          <span className="text-xs text-muted">(toi)</span>
                        ) : null}
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {side.players.map((player) => (
                          <li
                            key={player.userId}
                            className="flex items-center gap-2 text-sm text-muted"
                          >
                            <PlayerLink
                              userId={player.userId}
                              name={player.name}
                              avatar={player.avatar}
                            />
                            <span className="text-xs text-faint">
                              {INVITATION_LABELS[player.invitationStatus]}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {side.validatedAt ? (
                        <p className="mt-2 text-xs text-mint">Résultat validé</p>
                      ) : null}
                    </div>
                    {side.score !== null ? (
                      <Score value={side.score} tone={won ? 'mint' : 'ink'} size="lg" />
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <MatchActions
        matchId={match.id}
        status={effectiveStatus}
        requiresScore={match.ruleRequiresScore}
        sides={sides.map((side) => ({
          sideIndex: side.sideIndex,
          label: side.label,
          score: side.score,
        }))}
        mySide={mySide}
        permissions={permissions}
        isAdmin={me.role === 'admin'}
        gameMode={game.mode}
      />

      {awards.length > 0 ? (
        <section>
          <SectionTitle>Points attribués</SectionTitle>
          <Card reveal={2}>
            <ul className="divide-y divide-hairline">
              {awards.map((award, index) => (
                <li
                  key={`${award.userId}-${award.type}-${index}`}
                  className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{award.name}</span>
                    {/* The base win and the margin bonus are separate lines with
                        their arithmetic spelled out (spec 0005, rule 12). */}
                    <span className="block text-xs text-muted">
                      {POINT_TYPE_LABELS[award.type] ?? award.type} · {award.detail}
                    </span>
                  </span>
                  <Delta points={award.points} size="sm" />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      {effectiveStatus === 'completed' ? (
        <section>
          <SectionTitle>Points d’équipe</SectionTitle>
          <Card reveal={3}>
            {teamAwards.length > 0 ? (
              <ul className="divide-y divide-hairline">
                {teamAwards.map((award, index) => (
                  <li
                    key={`${award.teamName}-${award.type}-${index}`}
                    className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {award.teamName}
                      </span>
                      <span className="block text-xs text-muted">
                        {POINT_TYPE_LABELS[award.type] ?? award.type} · {award.detail}
                      </span>
                    </span>
                    <Delta points={award.points} size="sm" />
                  </li>
                ))}
              </ul>
            ) : (
              // A total that did not move has to be explained, or it reads as
              // a bug (spec 0017, failure cases).
              <p className="text-sm text-muted">
                Pas de points d’équipe : ce match n’oppose pas les deux équipes.
              </p>
            )}
          </Card>
        </section>
      ) : null}

      <section>
        <SectionTitle>Règles de cette partie</SectionTitle>
        <Card>
          {/* The snapshot, not the game's current configuration: this is why two
              matches of the same game can award different totals
              (spec 0005, rule 13). */}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted">Victoire</dt>
              <dd className="font-medium">{match.rulePointsPerWin} pts</dd>
            </div>
            <div>
              <dt className="text-muted">Bonus d’écart</dt>
              <dd className="font-medium">
                {match.ruleMarginBonusPerPoint > 0
                  ? `+${match.ruleMarginBonusPerPoint} / point${
                      match.ruleMarginBonusCap ? ` (max ${match.ruleMarginBonusCap})` : ''
                    }`
                  : 'aucun'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Score chiffré</dt>
              <dd className="font-medium">{match.ruleRequiresScore ? 'oui' : 'non'}</dd>
            </div>
          </dl>
        </Card>
      </section>

      <section>
        <SectionTitle>Déroulé</SectionTitle>
        <Card>
          <ol className="space-y-2 text-sm">
            {timeline
              .filter((step): step is { label: string; at: number } => step.at !== null)
              .map((step) => (
                <li key={step.label} className="flex items-baseline justify-between gap-3">
                  <span>{step.label}</span>
                  <span className="text-xs text-muted">{dateTime(step.at)}</span>
                </li>
              ))}
            {view.participants
              .filter((p) => p.respondedAt !== null && p.userId !== match.createdBy)
              .map((p) => (
                <li key={p.userId} className="flex items-baseline justify-between gap-3">
                  <span>
                    {p.name} {INVITATION_LABELS[p.invitationStatus]}
                  </span>
                  <span className="text-xs text-muted">
                    {p.respondedAt ? dateTime(p.respondedAt) : ''}
                  </span>
                </li>
              ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}
