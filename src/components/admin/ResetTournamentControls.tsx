'use client';

import { useState, useTransition } from 'react';

import { resetTournament } from '@/lib/actions/admin';

import { Button } from '../ui/Button';
import { ErrorMessage, Field, inputClass } from '../ui/Field';

export function ResetTournamentControls() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleConfirm = () => {
    if (confirmation.trim().toLowerCase() !== 'confirmer') {
      setError('Tape « confirmer » pour valider');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await resetTournament({ confirmation: confirmation.trim() });
      if (!result.ok) {
        setError(result.message ?? 'Impossible de réinitialiser');
        return;
      }
      setOpen(false);
      setConfirmation('');
      // Hard navigation to trigger the layout's team check or refresh the admin dashboard
      window.location.href = '/admin';
    });
  };

  return (
    <>
      <Button
        variant="danger"
        size="sm"
        full
        onClick={() => {
          setOpen(true);
          setError(null);
          setConfirmation('');
        }}
      >
        Remettre tout à zéro
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-xs"
          onClick={() => {
            if (!pending) {
              setOpen(false);
              setConfirmation('');
              setError(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-modal-title"
            className="sticker bg-surface p-5 max-w-md w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h2 id="reset-modal-title" className="display text-lg font-bold leading-tight text-ink">
                Remise à zéro du jeu
              </h2>
              <p className="text-xs text-muted leading-relaxed">
                Cette action est irréversible. Elle effacera définitivement tous les scores, l’historique des parties,
                les notifications et réinitialisera les équipes (sauf les capitaines). Les comptes joueurs et les jeux
                sont conservés.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              className="space-y-4"
            >
              <ErrorMessage>{error}</ErrorMessage>

              <Field
                label="Confirmation"
                hint="Écris « confirmer » ci-dessous pour valider la remise à zéro."
              >
                <input
                  type="text"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="confirmer"
                  className={inputClass}
                  autoFocus
                  disabled={pending}
                />
              </Field>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  full
                  disabled={pending}
                  onClick={() => {
                    setOpen(false);
                    setConfirmation('');
                    setError(null);
                  }}
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  full
                  disabled={pending || confirmation.trim().length === 0}
                >
                  {pending ? 'Remise à zéro…' : 'Confirmer'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
