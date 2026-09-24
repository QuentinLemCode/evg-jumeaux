'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { createMatch } from '@/lib/actions/matches';
import type { RosterEntryWithAvailability } from '@/lib/queries/roster';

import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ErrorMessage } from '../ui/Field';

type Game = {
  id: string;
  name: string;
  /** `clash` never reaches here: it has its own screen (`ClashForm`). */
  mode: 'duel' | 'team';
  sidesCount: number;
  playersPerSide: number;
};

type Me = { id: string; name: string; avatar: string };

/**
 * Fill every side, then send the invitations (spec 0004, rules 1-5).
 *
 * One interaction model covers every shape a game can have: pick the side you
 * are filling, then tap players. For the common 1v1 case there is only one
 * side to fill, so the side picker hides itself and it degrades to "tap your
 * opponent".
 */
export function NewMatchForm({
  game,
  me,
  roster,
}: {
  game: Game;
  me: Me;
  roster: RosterEntryWithAvailability[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The creator is locked onto side 1 (spec 0004, rule 2).
  const [assignments, setAssignments] = useState<Record<string, number>>({
    [me.id]: 1,
  });
  const sides = useMemo(
    () => Array.from({ length: game.sidesCount }, (_, i) => i + 1),
    [game.sidesCount],
  );
  const [targetSide, setTargetSide] = useState(game.sidesCount > 1 ? 2 : 1);

  const playersOn = (sideIndex: number) =>
    Object.entries(assignments)
      .filter(([, side]) => side === sideIndex)
      .map(([userId]) => userId);

  const complete = sides.every((side) => playersOn(side).length === game.playersPerSide);
  const remaining = sides.reduce(
    (total, side) => total + (game.playersPerSide - playersOn(side).length),
    0,
  );

  const nameOf = (userId: string) =>
    userId === me.id ? me.name : (roster.find((p) => p.id === userId)?.name ?? '?');

  function toggle(player: RosterEntryWithAvailability) {
    if (player.id === me.id || player.busy || pending) return;
    setError(null);
    setAssignments((current) => {
      const next = { ...current };
      if (next[player.id] !== undefined) {
        delete next[player.id];
        return next;
      }
      const taken = Object.values(next).filter((side) => side === targetSide).length;
      if (taken >= game.playersPerSide) {
        setError(`Le camp ${targetSide} est complet`);
        return current;
      }
      next[player.id] = targetSide;
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createMatch({
        gameId: game.id,
        assignments: Object.entries(assignments).map(([userId, sideIndex]) => ({
          userId,
          sideIndex,
        })),
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
      <Card>
        <div className="space-y-3">
          {sides.map((sideIndex) => {
            const players = playersOn(sideIndex);
            const isTarget = sideIndex === targetSide;
            return (
              <button
                key={sideIndex}
                type="button"
                onClick={() => setTargetSide(sideIndex)}
                className={[
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
                  isTarget
                    ? 'border-coral bg-coral/10'
                    : 'border-border bg-bg-elevated hover:bg-bg',
                ].join(' ')}
              >
                <span className="w-16 shrink-0 text-xs font-semibold tracking-wide text-muted uppercase">
                  {/* «Camp», never «équipe»: that word names one of the
                      weekend's two teams (spec 0017, rule 31). */}
                  {game.mode === 'duel' ? `Joueur ${sideIndex}` : `Camp ${sideIndex}`}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {players.map((userId) => (
                    <span
                      key={userId}
                      className="rounded-full bg-surface px-2 py-1 text-sm"
                    >
                      {nameOf(userId)}
                      {userId === me.id ? ' (toi)' : ''}
                    </span>
                  ))}
                  {Array.from({ length: game.playersPerSide - players.length }).map(
                    (_, index) => (
                      <span
                        key={`slot-${index}`}
                        className="rounded-full border border-dashed border-border px-2 py-1 text-sm text-faint"
                      >
                        à remplir
                      </span>
                    ),
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <ErrorMessage>{error}</ErrorMessage>

      <div>
        <p className="mb-2 text-sm text-muted">
          {remaining > 0
            ? `Ajoute ${remaining} joueur${remaining > 1 ? 's' : ''} au camp sélectionné.`
            : 'Tout le monde est placé.'}
        </p>
        <ul className="space-y-2">
          {roster
            .filter((player) => player.id !== me.id)
            .map((player) => {
              const side = assignments[player.id];
              const selected = side !== undefined;
              return (
                <li key={player.id}>
                  <button
                    type="button"
                    disabled={player.busy || pending}
                    onClick={() => toggle(player)}
                    className={[
                      'tap-target flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      selected
                        ? 'border-coral bg-coral/10'
                        : 'border-border bg-surface hover:bg-bg',
                      player.busy ? 'cursor-not-allowed opacity-40' : '',
                    ].join(' ')}
                  >
                    <Avatar emoji={player.avatar} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-medium">{player.name}</span>
                    {player.busy ? (
                      <span className="text-xs text-muted">déjà en partie</span>
                    ) : selected ? (
                      <span className="text-xs font-semibold text-coral">
                        {game.mode === 'duel' ? `Joueur ${side}` : `Camp ${side}`}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
        </ul>
      </div>

      {/* Primary action at the bottom, in thumb reach (spec 0009, rule 7). */}
      <div className="safe-bottom sticky bottom-20 md:bottom-4">
        <Button full size="lg" disabled={!complete || pending} onClick={submit}>
          {pending ? 'Envoi…' : 'Envoyer les invitations'}
        </Button>
      </div>
    </div>
  );
}
