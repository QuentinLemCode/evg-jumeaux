'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { assignScarfTheft } from '@/lib/actions/admin';
import type { RosterEntry } from '@/lib/queries/roster';

import { Button } from '../ui/Button';
import { ErrorMessage, Field, inputClass } from '../ui/Field';

export function ScarfTheftForm({ roster }: { roster: RosterEntry[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState(roster[0]?.id ?? '');
  const [points, setPoints] = useState('2');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div className="space-y-3">
      <ErrorMessage>{error}</ErrorMessage>
      {done ? <p className="text-sm text-mint">Vol de foulard enregistré.</p> : null}

      <Field label="Voleur">
        <select
          aria-label="Voleur"
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

      <Field label="Points" hint="Par défaut 2 points. Maximum ±1000.">
        <input
          type="number"
          inputMode="numeric"
          value={points}
          onChange={(event) => setPoints(event.target.value)}
          placeholder="2"
          className={inputClass}
        />
      </Field>

      <Field label="Commentaire (facultatif)" hint="ex. Dérobé discrètement au salon">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="ex. Dérobé discrètement au salon"
          maxLength={280}
          className={inputClass}
        />
      </Field>

      <Button
        full
        disabled={pending || points.trim() === ''}
        onClick={() => {
          setError(null);
          setDone(false);
          startTransition(async () => {
            const result = await assignScarfTheft({
              userId,
              points: Number(points),
              note: note.trim() || undefined,
            });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setPoints('2');
            setNote('');
            setDone(true);
            router.refresh();
          });
        }}
      >
        {pending ? 'Enregistrement…' : 'Attribuer le vol de foulard'}
      </Button>
    </div>
  );
}
