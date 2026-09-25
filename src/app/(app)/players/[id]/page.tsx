import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MatchSummaryCard } from '@/components/matches/MatchSummaryCard';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { teamAccent } from '@/components/teams/accent';
import { ButtonLink } from '@/components/ui/Button';
import { Card, SectionTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LogoutButton } from '@/components/LogoutButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { Delta, Score } from '@/components/ui/Score';
import { requireUser } from '@/lib/auth/guards';
import { POINT_TYPE_LABELS, dateTime } from '@/lib/format';
import { getPlayerProfile } from '@/lib/queries/players';
import { getPlayerTeam } from '@/lib/queries/teams';

export const dynamic = 'force-dynamic';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg-elevated px-3 py-2 text-center">
      <Score value={value} size="md" />
      <p className="text-[11px] tracking-wide text-muted uppercase">{label}</p>
    </div>
  );
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser(`/players/${id}`);
  const [profile, team] = await Promise.all([getPlayerProfile(id), getPlayerTeam(id)]);
  if (!profile) notFound();

  const { standing, ledger, perGame, history, winRate, busyMatchId, role } = profile;
  const isMe = me.id === id;
  const ledgerTotal = ledger.reduce((sum, entry) => sum + entry.points, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={standing.name}
        subtitle={`${standing.points} points · ${standing.played} parties`}
      />

      <Card>
        <div className="flex items-center gap-4">
          <Avatar emoji={standing.avatar} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="coral">#{standing.rank} au classement</Badge>
              {/* The player's team, linked to the team screen — the tie
                  between the two leaderboards is navigational and never
                  arithmetic (spec 0017, rule 29). */}
              {team ? (
                <Link href="/teams" data-testid="player-team">
                  <Badge tone={teamAccent(team.accent)}>
                    {team.name}
                    {team.isCaptain ? ' · capitaine' : ''}
                  </Badge>
                </Link>
              ) : (
                <Badge>Sans équipe</Badge>
              )}
              {role === 'admin' ? <Badge tone="grape">Admin</Badge> : null}
              {busyMatchId ? <Badge tone="tangerine">En partie</Badge> : null}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <Stat label="Points" value={String(standing.points)} />
          <Stat label="Victoires" value={String(standing.wins)} />
          <Stat label="Défaites" value={String(standing.losses)} />
          <Stat
            label="Ratio"
            value={winRate === null ? '—' : `${Math.round(winRate * 100)}%`}
          />
        </div>

        {busyMatchId ? (
          <div className="mt-3">
            <ButtonLink href={`/matches/${busyMatchId}`} size="sm" variant="secondary" full>
              Voir la partie en cours
            </ButtonLink>
          </div>
        ) : null}

        {isMe ? (
          <div className="mt-3">
            <LogoutButton />
          </div>
        ) : null}
      </Card>

      <section>
        <SectionTitle>Par jeu</SectionTitle>
        {perGame.length === 0 ? (
          <EmptyState illustration="🎲" title={`${standing.name} n’a pas encore joué`} />
        ) : (
          <Card reveal={0}>
            <ul className="divide-y divide-hairline">
              {perGame.map((game) => (
                <li
                  key={game.gameId}
                  className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="text-xl" aria-hidden>
                    {game.gameIcon}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{game.gameName}</span>
                  <Score value={`${game.won} / ${game.played}`} tone="muted" size="sm" />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle>Détail des points</SectionTitle>
        {ledger.length === 0 ? (
          <EmptyState illustration="📈" title="Pas encore de points" />
        ) : (
          <Card reveal={1}>
            <ul className="divide-y divide-hairline">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex items-baseline gap-3 py-2.5 first:pt-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {POINT_TYPE_LABELS[entry.type] ?? entry.type}
                      {entry.createdByName ? ` · par ${entry.createdByName}` : ''}
                    </span>
                    <span className="block text-xs text-muted">{entry.detail}</span>
                    <span className="block text-[11px] text-faint">
                      {dateTime(entry.createdAt)}
                    </span>
                  </span>
                  {entry.matchId ? (
                    <Link
                      href={`/matches/${entry.matchId}`}
                      className="text-xs text-muted underline"
                    >
                      partie
                    </Link>
                  ) : null}
                  <span className="w-14 text-right">
                    <Delta points={entry.points} size="sm" />
                  </span>
                </li>
              ))}
            </ul>
            {/* The column sums to the headline total, verifiable by eye — which
                is the entire point of the ledger (spec 0007, rule 12). */}
            <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
              <span className="text-sm font-medium">Total</span>
              <Score value={ledgerTotal} tone="coral" suffix="pts" />
            </div>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle>Ses parties</SectionTitle>
        {history.length === 0 ? (
          <EmptyState illustration="📜" title="Aucune partie" />
        ) : (
          <ul className="space-y-2">
            {history.map((match, index) => (
              <li key={match.id}>
                <MatchSummaryCard match={match} reveal={index} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
