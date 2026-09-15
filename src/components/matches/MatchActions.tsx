'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  acceptInvitation,
  cancelMatch,
  declineInvitation,
  disputeResult,
  reportResult,
  validateResult,
} from '@/lib/actions/matches';
import type { MatchStatus } from '@/lib/domain/types';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ErrorMessage, inputClass } from '../ui/Field';

type Side = { sideIndex: number; label: string };

type Permissions = {
  canAccept: boolean;
  canDecline: boolean;
  canReport: boolean;
  canValidate: boolean;
  canCancel: boolean;
};

/**
 * The action panel for a match (spec 0004). It renders what the state machine
 * says is possible — but the state machine is also what enforces it on the
 * server, so hiding a button here is presentation, never authorisation
 * (AGENTS.md §5).
 */
export function MatchActions({
  matchId,
  status,
  requiresScore,
  sides,
  mySide,
  permissions,
  isAdmin,
}: {
  matchId: string;
  status: MatchStatus;
  requiresScore: boolean;
  sides: Side[];
  mySide: number | null;
  permissions: Permissions;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'report' | 'dispute' | 'cancel'>('idle');
  const [winningSide, setWinningSide] = useState<number>(mySide ?? sides[0]?.sideIndex ?? 1);
  const [scores, setScores] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? 'Action impossible');
        return;
      }
      setMode('idle');
      setReason('');
      router.refresh();
    });
  }

  const nothingToDo =
    !permissions.canAccept &&
    !permissions.canDecline &&
    !permissions.canReport &&
    !permissions.canValidate &&
    !permissions.canCancel;

  if (nothingToDo && mode === 'idle') {
    if (status === 'awaiting_validation') {
      return (
        <Card className="border-grape/40 bg-grape/10">
          <p className="text-sm">
            En attente de la validation de l’autre camp. Personne ne marque avant.
          </p>
        </Card>
      );
    }
    if (status === 'disputed') {
      return (
        <Card className="border-coral/40 bg-coral/10">
          <p className="text-sm">
            Résultat contesté. Un admin doit trancher — aucun point n’est attribué en
            attendant.
          </p>
        </Card>
      );
    }
    return null;
  }

  return (
    <Card className="space-y-3">
      <ErrorMessage>{error}</ErrorMessage>

      {mode === 'idle' ? (
        <div className="space-y-2">
          {permissions.canAccept ? (
            <Button
              full
              size="lg"
              disabled={pending}
              onClick={() => run(() => acceptInvitation(matchId))}
            >
              Accepter le défi
            </Button>
          ) : null}

          {permissions.canDecline ? (
            <Button
              full
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => declineInvitation(matchId))}
            >
              Refuser
            </Button>
          ) : null}

          {permissions.canReport ? (
            <Button full size="lg" disabled={pending} onClick={() => setMode('report')}>
              Saisir le résultat
            </Button>
          ) : null}

          {permissions.canValidate ? (
            <>
              <Button
                full
                size="lg"
                variant="success"
                disabled={pending}
                onClick={() => run(() => validateResult(matchId))}
              >
                Je confirme ce résultat
              </Button>
              <Button
                full
                variant="danger"
                disabled={pending}
                onClick={() => setMode('dispute')}
              >
                Ce n’est pas ce qui s’est passé
              </Button>
            </>
          ) : null}

          {permissions.canCancel ? (
            <Button
              full
              variant="ghost"
              disabled={pending}
              onClick={() => setMode('cancel')}
            >
              Annuler la partie
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === 'report' ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Qui a gagné ?</p>
          <div className="space-y-2">
            {sides.map((side) => (
              <button
                key={side.sideIndex}
                type="button"
                onClick={() => setWinningSide(side.sideIndex)}
                className={[
                  'tap-target flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left',
                  winningSide === side.sideIndex
                    ? 'border-coral bg-coral/10'
                    : 'border-border bg-bg-elevated',
                ].join(' ')}
              >
                <span className="flex-1 truncate font-medium">{side.label}</span>
                {winningSide === side.sideIndex ? (
                  <span className="text-sm text-coral">gagnant</span>
                ) : null}
              </button>
            ))}
          </div>

          {requiresScore ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Score de chaque camp</p>
              {sides.map((side) => (
                <label key={side.sideIndex} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{side.label}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={999}
                    value={scores[side.sideIndex] ?? ''}
                    onChange={(event) =>
                      setScores((current) => ({
                        ...current,
                        [side.sideIndex]: event.target.value,
                      }))
                    }
                    className={`${inputClass} w-24 text-center`}
                    aria-label={`Score de ${side.label}`}
                  />
                </label>
              ))}
              <p className="text-xs text-faint">
                Le gagnant doit avoir le score le plus élevé. Les égalités ne sont pas
                possibles — annule la partie si personne n’a gagné.
              </p>
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setMode('idle')} disabled={pending}>
              Retour
            </Button>
            <Button
              full
              disabled={pending}
              onClick={() =>
                run(() =>
                  reportResult({
                    matchId,
                    winningSide,
                    scores: requiresScore
                      ? sides.map((side) => ({
                          sideIndex: side.sideIndex,
                          score: Number(scores[side.sideIndex] ?? ''),
                        }))
                      : [],
                  }),
                )
              }
            >
              {pending ? 'Envoi…' : 'Envoyer pour validation'}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'dispute' ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Que s’est-il passé ?</p>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={280}
            placeholder="Optionnel, mais ça aide l’admin à trancher"
            className={inputClass}
          />
          <p className="text-xs text-faint">
            La partie passera en « contestée » : aucun point n’est attribué jusqu’à ce
            qu’un admin décide.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setMode('idle')} disabled={pending}>
              Retour
            </Button>
            <Button
              full
              variant="danger"
              disabled={pending}
              onClick={() => run(() => disputeResult(matchId, reason))}
            >
              Contester
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'cancel' ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Annuler la partie ?</p>
          <p className="text-xs text-muted">
            Personne ne marque de points. {isAdmin ? 'Tu agis en tant qu’admin.' : ''}
          </p>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={280}
            placeholder="Motif (optionnel)"
            className={inputClass}
          />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setMode('idle')} disabled={pending}>
              Retour
            </Button>
            <Button
              full
              variant="danger"
              disabled={pending}
              onClick={() => run(() => cancelMatch(matchId, reason))}
            >
              Confirmer l’annulation
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
