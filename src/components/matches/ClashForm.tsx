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
 * game with bigger sides" — its sides ARE the teams, and it has no invitation
 * phase: the admin calls it and it is live. The one thing that can stop it is
 * somebody already being in another match, which is stated here rather than
 * discovered on submit.
 */
export function ClashForm({ gameId, sides }: { gameId: string; sides: ClashSide[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const busy = sides.flatMap((side) => side.members.filter((member) => member.busy));
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
                className={[
                  'pill flex items-center gap-1.5 bg-surface px-2 py-1 text-sm',
                  member.busy ? 'text-muted' : '',
                ].join(' ')}
              >
                <Avatar emoji={member.avatar} size="sm" />
                {member.name}
                {member.busy ? (
                  <span className="text-[11px] text-muted">déjà en partie</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <ErrorMessage>{error}</ErrorMessage>

      <p className="text-sm text-muted">
        {busy.length === 0
          ? `${total} joueurs, et la partie démarre tout de suite : personne n’a à confirmer.`
          : `${busy.map((member) => member.name).join(', ')} ${
              busy.length > 1 ? 'sont déjà en partie' : 'est déjà en partie'
            } — il faut attendre qu’ils aient fini.`}
      </p>

      {/* Primary action at the bottom, in thumb reach (spec 0009, rule 7). */}
      <div className="safe-bottom sticky bottom-20 md:bottom-4">
        <Button full size="lg" disabled={pending || busy.length > 0} onClick={submit}>
          {pending ? 'Envoi…' : 'Lancer le match des deux équipes'}
        </Button>
      </div>
    </div>
  );
}
