import { LiveRefresh } from '@/components/LiveRefresh';
import { MatchSummaryCard } from '@/components/matches/MatchSummaryCard';
import { ButtonLink } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Card';
import { ChipLink, ChipRow, ViewSwitch } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireUser } from '@/lib/auth/guards';
import { listGames } from '@/lib/queries/games';
import { listHistory, listLiveMatches } from '@/lib/queries/matches';
import { getRoster } from '@/lib/queries/roster';

export const dynamic = 'force-dynamic';

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string; player?: string; page?: string }>;
}) {
  await requireUser('/history');
  const { game, player, page } = await searchParams;
  const pageNumber = Number.parseInt(page ?? '1', 10) || 1;

  const [live, history, games, roster] = await Promise.all([
    listLiveMatches(),
    listHistory({ gameId: game, userId: player, page: pageNumber }),
    listGames(),
    getRoster(),
  ]);

  const query = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { game, player, page: undefined, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/history?${qs}` : '/history';
  };

  return (
    <div className="space-y-6">
      <LiveRefresh />

      {/* Two public views of the same screen (spec 0007, rule 0): the matches,
          and the admin log written for the players whose scores moved. */}
      <PageHeader title="Historique" subtitle="Toutes les parties, même annulées.">
        <ViewSwitch
          views={[
            { href: '/history', label: 'Parties', active: true },
            { href: '/admin-log', label: 'Journal', active: false },
          ]}
        />
      </PageHeader>

      {/* In-progress matches sit above the history, never mixed into it
          (spec 0007, rule 2). */}
      {live.length > 0 ? (
        <section>
          <SectionTitle>En ce moment</SectionTitle>
          <ul className="space-y-2">
            {live.map((match, index) => (
              <li key={match.id}>
                <MatchSummaryCard match={match} highlight reveal={index} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionTitle>Parties terminées</SectionTitle>

        <div className="mb-2">
          <ChipRow>
            <ChipLink href="/history" active={!game && !player}>
              Tout
            </ChipLink>
            {games.map((entry) => (
              <ChipLink
                key={entry.id}
                href={query({ game: game === entry.id ? undefined : entry.id })}
                active={game === entry.id}
              >
                {/* games.icon is an emoji by design (spec 0003) */}
                <span aria-hidden>{entry.icon}</span>
                {entry.name}
              </ChipLink>
            ))}
          </ChipRow>
        </div>

        <div className="mb-4">
          <ChipRow>
            {roster.map((entry) => (
              <ChipLink
                key={entry.id}
                href={query({ player: player === entry.id ? undefined : entry.id })}
                active={player === entry.id}
              >
                <span aria-hidden>{entry.avatar}</span>
                {entry.name}
              </ChipLink>
            ))}
          </ChipRow>
        </div>

        {history.matches.length === 0 ? (
          <EmptyState illustration="📜"
            title="Aucune partie pour le moment"
            action={<ButtonLink href="/games">Lance la première</ButtonLink>}
          >
            Les parties terminées, annulées et expirées apparaissent ici.
          </EmptyState>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {history.matches.map((match, index) => (
                <li key={match.id}>
                  <MatchSummaryCard match={match} reveal={index} />
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between gap-3">
              {pageNumber > 1 ? (
                <ButtonLink
                  href={query({ page: String(pageNumber - 1) })}
                  variant="secondary"
                  size="sm"
                >
                  ← Plus récentes
                </ButtonLink>
              ) : (
                <span />
              )}
              {history.hasMore ? (
                <ButtonLink
                  href={query({ page: String(pageNumber + 1) })}
                  variant="secondary"
                  size="sm"
                >
                  Plus anciennes →
                </ButtonLink>
              ) : (
                <span />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
