import { TeamChoice } from '@/components/teams/TeamChoice';
import { teamSticker } from '@/components/teams/accent';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TeamIcon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireUser } from '@/lib/auth/guards';
import { teamCapacity, teamChoiceOptions } from '@/lib/domain/teams';
import { countPlayers, getPlayerTeam, listTeams } from '@/lib/queries/teams';
import { safeDestination } from '@/lib/request-path';

export const dynamic = 'force-dynamic';

/**
 * The team choice (spec 0017, rules 11-14).
 *
 * OUTSIDE the `(app)` group on purpose: that group's layout is the gate that
 * sends a player here, so a choice screen inside it would redirect to itself.
 * It also means there is no navigation on this screen, which is the point —
 * a player with no team reaches nothing else until they have one.
 */
export default async function TeamChoicePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const me = await requireUser('/team-choice');
  const destination = safeDestination(next) ?? '/leaderboard';

  const [mine, teams, totalPlayers] = await Promise.all([
    getPlayerTeam(me.id),
    listTeams(),
    countPlayers(),
  ]);
  // Derived from the roster, never written down: a team is full at half of it
  // (spec 0017, rule 12).
  const capacity = teamCapacity(totalPlayers);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      {mine ? (
        <>
          <PageHeader
            title="Ton équipe est déjà faite"
            subtitle={
              mine.isCaptain
                ? `Tu es le capitaine de l’${mine.name}.`
                : `Tu joues avec l’${mine.name}.`
            }
          />
          <Card className={teamSticker(mine.accent)} reveal={0} revealKind="pop">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-mark border-2 border-ink bg-surface">
                <TeamIcon size={22} />
              </span>
              <p className="display min-w-0 flex-1 text-lg leading-tight font-black">
                {mine.name}
              </p>
            </div>
            <p className="mt-3 text-sm leading-snug text-muted">
              {mine.isCaptain
                ? 'Un capitaine reste dans son équipe tout le week-end.'
                : 'Le choix était définitif : on ne change pas d’équipe, et personne ne peut te déplacer.'}
            </p>
          </Card>

          <div className="safe-bottom mt-6">
            <ButtonLink href={destination} full size="lg">
              Continuer
            </ButtonLink>
          </div>
        </>
      ) : (
        <>
          <PageHeader
            title="Choisis ton camp"
            subtitle="Une équipe pour tout le week-end, et on n’en change pas."
          />
          <TeamChoice
            teams={teamChoiceOptions(teams, capacity).map((option) => {
              const team = teams.find((entry) => entry.teamId === option.teamId);
              return {
                ...option,
                slug: team?.slug ?? option.teamId,
                accent: team?.accent ?? 'sky',
              };
            })}
            next={destination}
          />
          <p className="mt-6 text-center text-xs text-faint">
            Une équipe est complète à {capacity} joueurs. Quand la première se
            remplit, tous les indécis rejoignent l’autre.
          </p>
        </>
      )}
    </main>
  );
}
