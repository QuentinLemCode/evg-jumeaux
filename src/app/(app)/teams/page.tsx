import Link from 'next/link';

import { LiveRefresh } from '@/components/LiveRefresh';
import { teamSticker, teamAccent } from '@/components/teams/accent';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionTitle } from '@/components/ui/Card';
import { ViewSwitch } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { CrownIcon, TeamIcon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { Score } from '@/components/ui/Score';
import { requireUser } from '@/lib/auth/guards';
import { getTeamStandings } from '@/lib/queries/teams';

export const dynamic = 'force-dynamic';

/**
 * The team leaderboard (spec 0017, rules 26-30).
 *
 * Its own screen, and never added to the player one: a team total added to
 * each of its members cannot reorder anybody inside a team and flips both
 * teams wholesale, which would turn the player leaderboard into a measure of
 * which team you joined (rule 27). The link between the two is navigational.
 */
export default async function TeamsPage() {
  const me = await requireUser('/teams');
  const standings = await getTeamStandings();
  const leaderPoints = standings[0]?.points ?? 0;
  const tied =
    standings.length > 1 && standings.every((team) => team.rank === standings[0]?.rank);

  return (
    <div className="space-y-6">
      <LiveRefresh />

      <PageHeader
        title="Les deux équipes"
        subtitle={
          tied
            ? 'Tout le monde à égalité. Tout se joue maintenant.'
            : 'Chaque partie gagnée rapporte ses points une fois à l’équipe.'
        }
      >
        <ViewSwitch
          views={[
            { href: '/leaderboard', label: 'Joueurs', active: false },
            { href: '/teams', label: 'Équipes', active: true },
          ]}
        />
      </PageHeader>

      {standings.length === 0 ? (
        <EmptyState illustration="🏳️" title="Pas encore d’équipes">
          Les deux équipes arrivent avec la prochaine mise à jour.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {standings.map((team, index) => {
            const mine = team.members.some((member) => member.userId === me.id);
            return (
              <li key={team.teamId}>
                <Card
                  className={teamSticker(team.accent)}
                  reveal={index}
                  revealKind="pop"
                >
                  <div
                    className="flex items-center gap-3"
                    data-testid="team-standing"
                    data-team={team.slug}
                    data-points={team.points}
                    data-rank={team.rank}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-mark border-2 border-ink bg-surface">
                      <TeamIcon size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="display block text-lg leading-tight font-black">
                        {team.name}
                      </span>
                      <span className="block text-xs text-muted">
                        {team.playerCount} joueur{team.playerCount > 1 ? 's' : ''} ·{' '}
                        {team.matchesWon} partie{team.matchesWon > 1 ? 's' : ''} gagnée
                        {team.matchesWon > 1 ? 's' : ''}
                      </span>
                    </span>
                    <Score
                      value={team.points}
                      tone={teamAccent(team.accent)}
                      size="lg"
                      suffix="pts"
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {tied ? (
                      <Badge tone="sky">À égalité</Badge>
                    ) : team.points === leaderPoints ? (
                      <Badge tone="mint">En tête</Badge>
                    ) : (
                      <Badge>{leaderPoints - team.points} pts derrière</Badge>
                    )}
                    {mine ? <Badge tone="grape">Ton équipe</Badge> : null}
                  </div>

                  <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
                    {team.members.map((member) => (
                      <li key={member.userId} className="py-2 first:pt-3 last:pb-0">
                        <Link
                          href={`/players/${member.userId}`}
                          className="flex items-center gap-2.5"
                        >
                          <Avatar emoji={member.avatar} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {member.name}
                          </span>
                          {member.isCaptain ? (
                            <span className="text-muted" title="Capitaine">
                              <CrownIcon size={16} />
                            </span>
                          ) : null}
                          <Score value={member.points} tone="muted" size="sm" suffix="pts" />
                        </Link>
                      </li>
                    ))}
                    {team.members.length === 0 ? (
                      <li className="py-3 text-sm text-muted">Personne pour l’instant.</li>
                    ) : null}
                  </ul>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <section>
        <SectionTitle>Comment une équipe marque</SectionTitle>
        <Card quiet>
          <ul className="space-y-1.5 text-sm leading-snug text-muted">
            <li>
              Une partie gagnée rapporte ses points <strong>une seule fois</strong> à
              l’équipe, quel que soit le nombre de joueurs dans le camp.
            </li>
            <li>
              Seules les parties qui opposent les deux équipes comptent : deux joueurs
              de la même équipe ne rapportent rien.
            </li>
            {/* Rule 23: a total that did not move has to be explained. */}
            <li>Les ajustements manuels ne comptent que pour le joueur.</li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
