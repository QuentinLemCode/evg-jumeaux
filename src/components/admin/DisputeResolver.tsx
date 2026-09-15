'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { resolveDispute } from '@/lib/actions/admin';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ErrorMessage, inputClass } from '../ui/Field';

type Side = { sideIndex: number; label: string; score: number | null };

/**
 * Resolving a dispute (spec 0008, rules 2-5): settle it with a decided winner
 * and scores, or cancel it. Points come from the match's own snapshot, so the
 * admin never chooses how much a win is worth — only who won.
 */
export function DisputeResolver({ matchId, sides }: { matchId: string; sides: Side[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'idle' | 'settle' | 'cancel'>('idle');
  const [winningSide, setWinningSide] = useState(sides[0]?.sideIndex ?? 1);
  const [scores, setScores] = useState<Record<number, string>>(
    Object.fromEntries(sides.map((s) => [s.sideIndex, s.score === null ? '' : String(s.score)])),
  );
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = (input: Parameters<typeof resolveDispute>[0]) => {
    setError(null);
    startTransition(async () => {
      const result = await resolveDispute(input);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMode('idle');
      router.refresh();
    });
  };

  return (
    <Card className="space-y-3">
      <ErrorMessage>{error}</ErrorMessage>

      {mode === 'idle' ? (
        <div className="flex gap-2">
          <Button full size="sm" onClick={() => setMode('settle')}>
            Trancher
          </Button>
          <Button full size="sm" variant="danger" onClick={() => setMode('cancel')}>
            Annuler la partie
          </Button>
        </div>
      ) : null}

      {mode === 'settle' ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Qui a gagné, selon toi ?</p>
          {sides.map((side) => (
            <div key={side.sideIndex} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWinningSide(side.sideIndex)}
                className={[
                  'tap-target flex-1 rounded-xl border px-3 py-2 text-left text-sm',
                  winningSide === side.sideIndex
                    ? 'border-coral bg-coral/10'
                    : 'border-border bg-bg-elevated',
                ].join(' ')}
              >
                {side.label}
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={scores[side.sideIndex] ?? ''}
                onChange={(event) =>
                  setScores((current) => ({
                    ...current,
                    [side.sideIndex]: event.target.value,
                  }))
                }
                className={`${inputClass} w-20 text-center`}
                aria-label={`Score de ${side.label}`}
              />
            </div>
          ))}
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={280}
            placeholder="Pourquoi cette décision ? (visible par tous)"
            className={inputClass}
          />
          <p className="text-xs text-muted">
            Ton motif apparaîtra dans le journal des admins, que tout le monde peut lire.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode('idle')}>
              Retour
            </Button>
            <Button
              full
              size="sm"
              disabled={pending || note.trim().length < 5}
              onClick={() =>
                run({
                  matchId,
                  outcome: {
                    kind: 'settle',
                    winningSide,
                    note: note.trim(),
                    scores: sides
                      .filter((side) => (scores[side.sideIndex] ?? '') !== '')
                      .map((side) => ({
                        sideIndex: side.sideIndex,
                        score: Number(scores[side.sideIndex]),
                      })),
                  },
                })
              }
            >
              Valider la décision
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'cancel' ? (
        <div className="space-y-2">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motif de l’annulation"
            maxLength={280}
            className={inputClass}
          />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode('idle')}>
              Retour
            </Button>
            <Button
              full
              size="sm"
              variant="danger"
              disabled={pending || reason.trim().length === 0}
              onClick={() =>
                run({ matchId, outcome: { kind: 'cancel', reason: reason.trim() } })
              }
            >
              Annuler, personne ne marque
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
