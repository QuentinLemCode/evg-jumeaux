import { TeamChoice } from '@/components/teams/TeamChoice';
import { teamSticker } from '@/components/teams/accent';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TeamIcon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireUser } from '@/lib/auth/guards';
import { teamChoiceOptions } from '@/lib/domain/teams';
import { getPlayerTeam, listTeams } from '@/lib/queries/teams';
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

  const [mine, teams] = await Promise.all([getPlayerTeam(me.id), listTeams()]);

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
                : 'On ne change pas d’équipe en cours de route. Un admin peut le faire, avec un motif, et ça se voit dans le journal.'}
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
            subtitle="Une équipe pour tout le week-end. On ne peut pas en changer après."
          />
          <TeamChoice
            teams={teamChoiceOptions(teams).map((option) => {
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
            Les deux équipes restent à un joueur près : si l’une prend de
            l’avance, elle attend.
          </p>
        </>
      )}
    </main>
  );
}
