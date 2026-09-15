'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { adminCancelMatch, forceExpireMatch } from '@/lib/actions/admin';
import type { MatchStatus } from '@/lib/domain/types';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ErrorMessage, inputClass } from '../ui/Field';

export function AdminMatchControls({
  matchId,
  status,
}: {
  matchId: string;
  status: MatchStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Cancelling a completed match moves the leaderboard, so it takes a typed
  // confirmation (spec 0008, failure table).
  const needsConfirmation = status === 'completed';

  const run = (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? 'Action impossible');
        return;
      }
      setOpen(false);
      setReason('');
      setConfirmation('');
      router.refresh();
    });
  };

  return (
    <Card className="space-y-2">
      <ErrorMessage>{error}</ErrorMessage>

      {!open ? (
        <div className="flex gap-2">
          <Button full size="sm" variant="danger" onClick={() => setOpen(true)}>
            Annuler la partie
          </Button>
          {status === 'pending' ? (
            <Button
              full
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => forceExpireMatch(matchId))}
            >
              Forcer l’expiration
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motif (obligatoire)"
            maxLength={280}
            className={inputClass}
          />
          {needsConfirmation ? (
            <>
              <p className="text-xs text-coral">
                Cette partie est terminée : l’annuler retirera les points déjà attribués.
              </p>
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="Tape ANNULER pour confirmer"
                className={inputClass}
              />
            </>
          ) : null}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Retour
            </Button>
            <Button
              full
              size="sm"
              variant="danger"
              disabled={pending || reason.trim().length === 0}
              onClick={() =>
                run(() =>
                  adminCancelMatch(
                    { matchId, reason: reason.trim(), confirmation },
                    needsConfirmation,
                  ),
                )
              }
            >
              Confirmer
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
