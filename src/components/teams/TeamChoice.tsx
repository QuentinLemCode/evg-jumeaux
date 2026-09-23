'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { ErrorMessage } from '@/components/ui/Field';
import { TeamIcon } from '@/components/ui/Icon';
import { Score } from '@/components/ui/Score';
import { reveal } from '@/components/ui/reveal';
import { chooseMyTeam } from '@/lib/actions/teams';
import type { TeamChoiceOption } from '@/lib/domain/teams';

import { teamAccent, teamSticker } from './accent';

export type ChoosableTeam = TeamChoiceOption & { slug: string; accent: string };

/**
 * The one-time team choice (spec 0017, rules 9-12).
 *
 * Both teams are always shown. The one that is a player ahead is shown
 * DISABLED, naming itself and the reason — a team that silently disappears
 * from the screen reads as a bug, and the guest standing next to their friend
 * needs to know why they cannot follow them.
 */
export function TeamChoice({
  teams,
  next,
}: {
  teams: ChoosableTeam[];
  next: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  function choose(teamId: string) {
    setError(null);
    setChosen(teamId);
    startTransition(async () => {
      const result = await chooseMyTeam(teamId);
      if (!result.ok) {
        setError(result.message);
        setChosen(null);
        // Somebody else just moved the count: show the screen as it is now.
        router.refresh();
        return;
      }
      router.replace(next);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ErrorMessage>{error}</ErrorMessage>

      {teams.map((team, index) => {
        const entrance = reveal(index, 'pop');
        const accent = teamAccent(team.accent);
        return (
          <button
            key={team.teamId}
            type="button"
            data-testid="team-option"
            data-team={team.slug}
            disabled={!team.joinable || pending}
            onClick={() => choose(team.teamId)}
            className={[
              'tap-target sticker w-full p-4 text-left transition-colors',
              teamSticker(team.accent),
              'disabled:pointer-events-none disabled:grayscale',
              entrance.className,
            ].join(' ')}
            style={entrance.style}
          >
            <span className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-mark border-2 border-ink bg-surface">
                <TeamIcon size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="display block text-lg leading-tight font-black">
                  {team.name}
                </span>
                <span className="block text-xs text-muted">
                  {team.memberCount === 0
                    ? 'personne pour l’instant'
                    : `${team.memberCount} joueur${team.memberCount > 1 ? 's' : ''}`}
                </span>
              </span>
              <Score
                value={team.memberCount}
                tone={accent}
                size="lg"
                className="shrink-0"
              />
            </span>

            <span className="display mt-3 block text-sm font-bold">
              {chosen === team.teamId && pending
                ? 'On t’installe…'
                : team.joinable
                  ? 'Rejoindre cette équipe'
                  : team.blockedReason}
            </span>
          </button>
        );
      })}
    </div>
  );
}
