'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorMessage } from '@/components/ui/Field';
import { AlertIcon, TeamIcon } from '@/components/ui/Icon';
import { Score } from '@/components/ui/Score';
import { reveal } from '@/components/ui/reveal';
import { chooseMyTeam } from '@/lib/actions/teams';
import type { TeamChoiceOption } from '@/lib/domain/teams';

import { teamAccent, teamSticker } from './accent';

export type ChoosableTeam = TeamChoiceOption & { slug: string; accent: string };

/**
 * The one-time team choice (spec 0017, rules 11-17).
 *
 * Both teams are always shown. A full one is shown DISABLED, naming itself
 * and the reason — a team that silently disappears from the screen reads as a
 * bug, and the guest standing next to their friend needs to know why they
 * cannot follow them (rule 16).
 *
 * Picking a team does NOT join it. The choice is final, the screen says so in
 * those words before anything is written, and confirming is a deliberate
 * second action rather than a mis-tap on a phone in a noisy room (rule 17).
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
  /** Picked, not joined: nothing is written until the confirmation. */
  const [picked, setPicked] = useState<ChoosableTeam | null>(null);

  function confirm(team: ChoosableTeam) {
    setError(null);
    startTransition(async () => {
      const result = await chooseMyTeam(team.teamId);
      if (!result.ok) {
        setError(result.message);
        setPicked(null);
        // Somebody else just took the last slot: show the screen as it is now.
        router.refresh();
        return;
      }
      router.replace(next);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ErrorMessage>{error}</ErrorMessage>

      {/* Stated before anything can be confirmed, and not as fine print:
          this is the sentence a guest is owed (rule 17). */}
      <Card accent="tangerine" className="flex items-start gap-3 p-3" reveal={0}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-mark border-2 border-tangerine bg-surface text-tangerine-deep">
          <AlertIcon size={18} strokeWidth={2.2} />
        </span>
        <p className="text-xs leading-snug">
          <span className="font-bold">Ce choix est définitif.</span> On ne change
          pas d’équipe après, et personne ne peut te déplacer — même pas un admin.
        </p>
      </Card>

      {teams.map((team, index) => {
        const entrance = reveal(index + 1, 'pop');
        const accent = teamAccent(team.accent);
        const isPicked = picked?.teamId === team.teamId;
        return (
          <div key={team.teamId}>
            <button
              type="button"
              data-testid="team-option"
              data-team={team.slug}
              aria-pressed={isPicked}
              disabled={!team.joinable || pending}
              onClick={() => setPicked(team)}
              className={[
                'tap-target sticker w-full p-4 text-left transition-colors',
                teamSticker(team.accent),
                isPicked ? 'ring-3 ring-ink' : '',
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
                {team.joinable
                  ? isPicked
                    ? 'Choisie — confirme en dessous'
                    : 'Choisir cette équipe'
                  : team.blockedReason}
              </span>
            </button>

            {/* The second action. It appears under the team it commits to, so
                what is being confirmed is never ambiguous. */}
            {isPicked ? (
              <div className="mt-2 flex flex-col gap-2">
                <Button
                  full
                  size="lg"
                  disabled={pending}
                  data-testid="confirm-team"
                  onClick={() => confirm(team)}
                >
                  {pending ? 'On t’installe…' : `Confirmer : je rejoins ${team.name}`}
                </Button>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setPicked(null)}
                >
                  Revenir en arrière
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
