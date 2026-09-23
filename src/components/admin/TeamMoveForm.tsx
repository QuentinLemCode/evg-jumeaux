'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { moveToTeam } from '@/lib/actions/teams';

import { Button } from '../ui/Button';
import { ErrorMessage, Field, inputClass } from '../ui/Field';

export type MovablePlayer = {
  id: string;
  name: string;
  teamName: string | null;
  isCaptain: boolean;
};

export type MoveTarget = { teamId: string; name: string };

/**
 * Moving a player between teams (spec 0017, rules 13-16).
 *
 * Exempt from the balance rule — it is the tool for fixing a split that
 * attendance, not choice, made lopsided — and it carries no points: the
 * player keeps theirs and the old team keeps what it earned. It does carry a
 * motive, which lands in the public log like every other intervention.
 */
export function TeamMoveForm({
  players,
  teams,
}: {
  players: MovablePlayer[];
  teams: MoveTarget[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const movable = players.filter((player) => !player.isCaptain);
  const [userId, setUserId] = useState(movable[0]?.id ?? '');
  const [teamId, setTeamId] = useState(teams[0]?.teamId ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div className="space-y-3">
      <ErrorMessage>{error}</ErrorMessage>
      {done ? <p className="text-sm text-mint">Joueur déplacé.</p> : null}

      {/* "Joueur à déplacer" and not "Joueur": the adjust-points form on the
          same screen already owns that name, and two controls answering to it
          is a test that picks the wrong one. */}
      <Field label="Joueur à déplacer">
        <select
          aria-label="Joueur à déplacer"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          className={inputClass}
        >
          {movable.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name} — {player.teamName ?? 'sans équipe'}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Nouvelle équipe">
        <select
          aria-label="Nouvelle équipe"
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
          className={inputClass}
        >
          {teams.map((team) => (
            <option key={team.teamId} value={team.teamId}>
              {team.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Motif" hint="Visible par tout le monde dans le journal des admins.">
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="ex. Arrivé samedi, équipe en sous-effectif"
          maxLength={280}
          className={inputClass}
        />
      </Field>

      <Button
        full
        disabled={pending || userId === '' || teamId === '' || reason.trim().length < 5}
        onClick={() => {
          setError(null);
          setDone(false);
          startTransition(async () => {
            const result = await moveToTeam({ userId, teamId, reason: reason.trim() });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setReason('');
            setDone(true);
            router.refresh();
          });
        }}
      >
        {pending ? 'Déplacement…' : 'Déplacer le joueur'}
      </Button>
    </div>
  );
}
