'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { adjustPoints } from '@/lib/actions/admin';
import type { RosterEntry } from '@/lib/queries/roster';

import { Button } from '../ui/Button';
import { ErrorMessage, Field, inputClass } from '../ui/Field';

export function AdjustPointsForm({ roster }: { roster: RosterEntry[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState(roster[0]?.id ?? '');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div className="space-y-3">
      <ErrorMessage>{error}</ErrorMessage>
      {done ? <p className="text-sm text-mint">Ajustement enregistré.</p> : null}

      <Field label="Joueur">
        {/* An explicit name: `Field` wraps its child in the <label>, so the
            label's text also contains every <option>, and the control has no
            unambiguous name without this. */}
        <select
          aria-label="Joueur"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          className={inputClass}
        >
          {roster.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Points" hint="Négatif pour retirer des points. Maximum ±1000.">
        <input
          type="number"
          inputMode="numeric"
          value={points}
          onChange={(event) => setPoints(event.target.value)}
          placeholder="ex. 25 ou -10"
          className={inputClass}
        />
      </Field>

      <Field label="Motif" hint="Visible par tout le monde dans le profil du joueur.">
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="ex. Vainqueur du concours de grimaces"
          maxLength={280}
          className={inputClass}
        />
      </Field>

      <Button
        full
        disabled={pending || points.trim() === '' || reason.trim().length < 5}
        onClick={() => {
          setError(null);
          setDone(false);
          startTransition(async () => {
            const result = await adjustPoints({
              userId,
              points: Number(points),
              reason: reason.trim(),
            });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setPoints('');
            setReason('');
            setDone(true);
            router.refresh();
          });
        }}
      >
        {pending ? 'Enregistrement…' : 'Ajuster les points'}
      </Button>
    </div>
  );
}
