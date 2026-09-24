'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { teamSticker } from '@/components/teams/accent';
import { createMatch } from '@/lib/actions/matches';
import type { ClashSide } from '@/lib/queries/teams';

import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ErrorMessage } from '../ui/Field';

/**
 * Starting a clash: the two teams, in full, against each other
 * (spec 0017, rules 3-6).
 *
 * There is nothing to pick and nobody to wait for. A clash is not "a team
 * game with bigger sides" — its sides ARE the teams, it has no invitation
 * phase, and it runs ALONGSIDE whatever else is being played: a darts match
 * in progress neither blocks it nor is blocked by it (rule 6). So this screen
 * shows no availability and withholds nothing; the only thing that can refuse
 * it is another clash already under way, which the server says on submit.
 */
export function ClashForm({ gameId, sides }: { gameId: string; sides: ClashSide[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = sides.reduce((count, side) => count + side.members.length, 0);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createMatch({
        gameId,
        assignments: sides.flatMap((side) =>
          side.members.map((member) => ({
            userId: member.id,
            sideIndex: side.sideIndex,
          })),
        ),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.replace(`/matches/${result.data.matchId}`);
    });
  }

  return (
    <div className="space-y-4">
      {sides.map((side, index) => (
        <Card
          key={side.teamId}
          className={teamSticker(side.accent)}
          reveal={index}
          revealKind="pop"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="display text-lg leading-tight font-black">{side.teamName}</p>
            <p className="text-xs text-muted">
              {side.members.length} joueur{side.members.length > 1 ? 's' : ''}
            </p>
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {side.members.map((member) => (
              <li
                key={member.id}
                className="pill flex items-center gap-1.5 bg-surface px-2 py-1 text-sm"
              >
                <Avatar emoji={member.avatar} size="sm" />
                {member.name}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <ErrorMessage>{error}</ErrorMessage>

      <p className="text-sm text-muted">
        {total} joueurs, et la partie démarre tout de suite : personne n’a à
        confirmer. Les parties déjà en cours continuent en parallèle.
      </p>

      {/* Primary action at the bottom, in thumb reach (spec 0009, rule 7). */}
      <div className="safe-bottom sticky bottom-20 md:bottom-4">
        <Button full size="lg" disabled={pending} onClick={submit}>
          {pending ? 'Envoi…' : 'Lancer le match des deux équipes'}
        </Button>
      </div>
    </div>
  );
}
