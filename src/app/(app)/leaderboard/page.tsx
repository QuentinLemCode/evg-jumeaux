import Link from 'next/link';

import { LiveRefresh } from '@/components/LiveRefresh';
import { MatchSummaryCard } from '@/components/matches/MatchSummaryCard';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonLink } from '@/components/ui/Button';
import { Card, SectionTitle } from '@/components/ui/Card';
import { ViewSwitch } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Score } from '@/components/ui/Score';
import { reveal } from '@/components/ui/reveal';
import { requireUser } from '@/lib/auth/guards';
import { getStandings, type Standing } from '@/lib/queries/leaderboard';
import { listMyOpenMatches } from '@/lib/queries/matches';

export const dynamic = 'force-dynamic';

const MEDAL_TONE = ['gold', 'silver', 'bronze'] as const;

function ringFor(rank: number) {
  if (rank === 1) return 'gold' as const;
  if (rank === 2) return 'silver' as const;
  if (rank === 3) return 'bronze' as const;
  return undefined;
}

function StandingRow({
  standing,
  isMe,
  index,
}: {
  standing: Standing;
  isMe: boolean;
  index: number;
}) {
  const medalTone = standing.rank <= 3 ? MEDAL_TONE[standing.rank - 1] : null;
  const entrance = reveal(index);
  return (
    <li>
      <Link
        href={`/players/${standing.userId}`}
        data-testid="standing"
        data-user={standing.userId}
        data-points={standing.points}
        data-rank={standing.rank}
        className={[
          'sticker flex items-center gap-3 px-3 py-3 transition-colors',
          // The reader's own row is the one accent in the list (spec 0010 §8).
          isMe ? 'sticker-grape' : 'hover:bg-bg',
          entrance.className,
        ].join(' ')}
        style={entrance.style}
      >
        <Score
          value={standing.rank}
          tone={medalTone ?? 'muted'}
          size={medalTone ? 'md' : 'sm'}
          className="w-8 text-center"
        />
        <Avatar emoji={standing.avatar} ring={ringFor(standing.rank)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{standing.name}</span>
          <span className="block text-xs text-muted">
            {standing.played === 0 && standing.scarfTheftsCount === 0
              ? 'Pas encore joué'
              : `${standing.wins} V · ${standing.losses} D · ${standing.scarfTheftsCount} ${
                  standing.scarfTheftsCount > 1 ? 'vols' : 'vol'
                } (${standing.scarfTheftsPoints} ${
                  Math.abs(standing.scarfTheftsPoints) > 1 ? 'pts' : 'pt'
                })`}
          </span>
        </span>
        <Score value={standing.points} tone={isMe ? 'grape' : 'coral'} suffix="pts" />
      </Link>
    </li>
  );
}

export default async function LeaderboardPage() {
  const me = await requireUser('/leaderboard');
  const [standings, myMatches] = await Promise.all([
    getStandings(),
    listMyOpenMatches(me.id),
  ]);

  const myStanding = standings.find((s) => s.userId === me.id);
  const distributed = standings.reduce((total, s) => total + s.points, 0);

  return (
    <div className="space-y-6">
      <LiveRefresh />

      <PageHeader
        title="Classement"
        subtitle={`${standings.length} joueurs · ${distributed} points distribués`}
        action={
          <ButtonLink href="/games" size="sm" variant="secondary">
            Jouer
          </ButtonLink>
        }
      >
        {/* The two leaderboards are never added together — the link between
            them is navigational (spec 0017, rule 26). */}
        <ViewSwitch
          views={[
            { href: '/leaderboard', label: 'Joueurs', active: true },
            { href: '/teams', label: 'Équipes', active: false },
          ]}
        />
      </PageHeader>

      {myMatches.length > 0 ? (
        <section>
          <SectionTitle>À toi de jouer</SectionTitle>
          <ul className="space-y-2">
            {myMatches.map((match, index) => (
              <li key={match.id}>
                <MatchSummaryCard match={match} highlight reveal={index} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        {standings.length === 0 ? (
          <EmptyState illustration="🏆" title="Personne au classement">
            Le classement se remplit dès la première partie validée.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {standings.map((standing, index) => (
              <StandingRow
                key={standing.userId}
                standing={standing}
                isMe={standing.userId === me.id}
                index={index}
              />
            ))}
          </ul>
        )}
      </section>

      {/* The player's own row, always reachable without scrolling
          (spec 0005, rule 18). */}
      {myStanding ? (
        <Card accent="grape" className="sticky bottom-24 md:bottom-4">
          <div className="flex items-center gap-3">
            <Score value={myStanding.rank} tone="grape" size="sm" className="w-8 text-center" />
            <Avatar emoji={myStanding.avatar} size="sm" />
            <span className="display flex-1 text-sm font-bold">Toi</span>
            <Score value={myStanding.points} tone="grape" suffix="pts" />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
