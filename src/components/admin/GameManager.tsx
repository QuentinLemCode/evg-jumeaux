'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createGame, setGameArchived, updateGame } from '@/lib/actions/games';
import type { GameMode } from '@/lib/domain/types';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorMessage, Field, FieldGroup, inputClass } from '../ui/Field';

export type ManagedGame = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  mode: GameMode;
  sidesCount: number;
  playersPerSide: number;
  pointsPerWin: number;
  marginBonusEnabled: boolean;
  marginBonusPerPoint: number;
  marginBonusCap: number | null;
  requiresScore: boolean;
  isActive: boolean;
  matchCount: number;
};

type Draft = {
  name: string;
  description: string;
  icon: string;
  mode: GameMode;
  sidesCount: number;
  playersPerSide: number;
  pointsPerWin: number;
  marginBonusEnabled: boolean;
  marginBonusPerPoint: number;
  marginBonusCap: string;
  requiresScore: boolean;
};

/**
 * «Camp» and not «équipe» for a side of a match: «équipe» now names one of
 * the weekend's two teams (spec 0017, rule 30).
 */
const MODE_LABELS: Record<GameMode, string> = {
  duel: 'Chacun pour soi',
  team: 'Par camps',
  clash: 'Les deux équipes',
};

const BLANK: Draft = {
  name: '',
  description: '',
  icon: '🎲', // design-lint-allow: games.icon stores an emoji (spec 0003)
  mode: 'duel',
  sidesCount: 2,
  playersPerSide: 1,
  pointsPerWin: 10,
  marginBonusEnabled: false,
  marginBonusPerPoint: 1,
  marginBonusCap: '',
  requiresScore: false,
};

function toDraft(game: ManagedGame): Draft {
  return {
    name: game.name,
    description: game.description ?? '',
    icon: game.icon,
    mode: game.mode,
    sidesCount: game.sidesCount,
    playersPerSide: game.playersPerSide,
    pointsPerWin: game.pointsPerWin,
    marginBonusEnabled: game.marginBonusEnabled,
    marginBonusPerPoint: game.marginBonusPerPoint || 1,
    marginBonusCap: game.marginBonusCap === null ? '' : String(game.marginBonusCap),
    requiresScore: game.requiresScore,
  };
}

export function GameManager({ games }: { games: ManagedGame[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => {
      const next = { ...current, [key]: value };
      // A duel is one player per side, by definition (spec 0003, rule 3), and
      // a clash is the two teams in full — it stores 1 and never reads it
      // (spec 0017, rule 1).
      if (key === 'mode') {
        next.playersPerSide = value === 'team' ? Math.max(2, current.playersPerSide) : 1;
        if (value === 'clash' || (value === 'team' && current.mode === 'duel')) {
          next.sidesCount = 2;
        }
      }
      // A margin cannot be computed without scores, so enabling the bonus
      // forces them on rather than saving a rule that can never fire.
      if (key === 'marginBonusEnabled' && value === true) next.requiresScore = true;
      return next;
    });

  function save() {
    setError(null);
    const input = {
      name: draft.name,
      description: draft.description,
      icon: draft.icon,
      mode: draft.mode,
      sidesCount: draft.sidesCount,
      playersPerSide: draft.playersPerSide,
      pointsPerWin: draft.pointsPerWin,
      marginBonusEnabled: draft.marginBonusEnabled,
      marginBonusPerPoint: draft.marginBonusPerPoint,
      marginBonusCap: draft.marginBonusCap === '' ? null : Number(draft.marginBonusCap),
      requiresScore: draft.requiresScore,
    };

    startTransition(async () => {
      const result =
        editing === 'new'
          ? await createGame(input)
          : await updateGame(editing as string, input);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setEditing(null);
      setDraft(BLANK);
      router.refresh();
    });
  }

  const form = (
    <Card className="space-y-3">
      <ErrorMessage>{error}</ErrorMessage>

      <div className="flex gap-3">
        <Field label="Emoji">
          <input
            value={draft.icon}
            onChange={(event) => set('icon', event.target.value)}
            maxLength={8}
            className={`${inputClass} w-20 text-center text-2xl`}
          />
        </Field>
        <div className="flex-1">
          <Field label="Nom">
            <input
              value={draft.name}
              onChange={(event) => set('name', event.target.value)}
              maxLength={60}
              placeholder="ex. Molkky"
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      <Field label="Règle du jeu" hint="Optionnel, affiché aux joueurs.">
        <input
          value={draft.description}
          onChange={(event) => set('description', event.target.value)}
          maxLength={280}
          placeholder="ex. Premier à 50 points pile"
          className={inputClass}
        />
      </Field>

      <FieldGroup label="Format">
        <div className="flex gap-2">
          {(['duel', 'team', 'clash'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => set('mode', mode)}
              className={[
                'tap-target flex-1 rounded-xl border px-3 py-2 text-sm',
                draft.mode === mode
                  ? 'border-coral bg-coral/10 text-coral'
                  : 'border-border bg-bg-elevated text-muted',
              ].join(' ')}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </FieldGroup>

      <div className="grid grid-cols-2 gap-3">
        {draft.mode === 'clash' ? (
          // Two sides, as big as the teams are: there is nothing to configure
          // (spec 0017, rule 1).
          <p className="col-span-2 text-xs text-muted">
            Les deux équipes du week-end s’affrontent au complet. Pas de taille à
            régler : elles n’ont pas besoin d’être de la même taille.
          </p>
        ) : (
          <Field
            label={draft.mode === 'duel' ? 'Nombre de joueurs' : 'Nombre de camps'}
            hint={
              draft.mode === 'duel'
                ? 'Chaque joueur joue pour soi (1 contre 1, ou chacun pour soi jusqu’à 4).'
                : 'Nombre de camps qui s’affrontent (ex : 2 pour un 2v2).'
            }
          >
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={4}
              value={draft.sidesCount}
              onChange={(event) => set('sidesCount', Number(event.target.value))}
              className={inputClass}
            />
          </Field>
        )}
        {draft.mode === 'team' ? (
          <Field
            label="Joueurs par camp"
            hint="Nombre de joueurs dans chaque camp (ex : 2 pour un 2v2)."
          >
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={6}
              value={draft.playersPerSide}
              onChange={(event) => set('playersPerSide', Number(event.target.value))}
              className={inputClass}
            />
          </Field>
        ) : null}
      </div>

      <Field label="Points au vainqueur" hint="Chaque joueur du camp gagnant les reçoit.">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={draft.pointsPerWin}
          onChange={(event) => set('pointsPerWin', Number(event.target.value))}
          className={inputClass}
        />
      </Field>

      <label className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-3 py-3">
        <input
          type="checkbox"
          checked={draft.marginBonusEnabled}
          onChange={(event) => set('marginBonusEnabled', event.target.checked)}
          className="size-5"
        />
        <span className="text-sm">
          <span className="block font-medium">Bonus d’écart</span>
          <span className="block text-xs text-muted">
            Récompense les écrasements. Détaillé ligne par ligne dans l’historique.
          </span>
        </span>
      </label>

      {draft.marginBonusEnabled ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Points par écart">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              value={draft.marginBonusPerPoint}
              onChange={(event) => set('marginBonusPerPoint', Number(event.target.value))}
              className={inputClass}
            />
          </Field>
          <Field label="Plafond" hint="Vide = pas de plafond">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={200}
              value={draft.marginBonusCap}
              onChange={(event) => set('marginBonusCap', event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      ) : null}

      <label className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-3 py-3">
        <input
          type="checkbox"
          checked={draft.requiresScore}
          disabled={draft.marginBonusEnabled}
          onChange={(event) => set('requiresScore', event.target.checked)}
          className="size-5"
        />
        <span className="text-sm">
          <span className="block font-medium">Score chiffré obligatoire</span>
          <span className="block text-xs text-muted">
            {draft.marginBonusEnabled
              ? 'Imposé par le bonus d’écart.'
              : 'Sinon on enregistre juste le vainqueur.'}
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setEditing(null);
            setError(null);
          }}
        >
          Annuler
        </Button>
        <Button full disabled={pending || draft.name.trim().length < 2} onClick={save}>
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>

      {editing !== 'new' ? (
        <p className="text-xs text-faint">
          Modifier les points n’affecte que les parties créées après. Les parties déjà
          jouées gardent leurs règles.
        </p>
      ) : null}
    </Card>
  );

  return (
    <div className="space-y-4">
      {editing === null ? (
        <Button
          full
          onClick={() => {
            setDraft(BLANK);
            setEditing('new');
          }}
        >
          + Créer un jeu
        </Button>
      ) : null}

      {editing === 'new' ? form : null}

      {games.length === 0 && editing === null ? (
        <EmptyState illustration="🎲" title="Aucun jeu">
          Crée le premier jeu pour que les invités puissent se défier.
        </EmptyState>
      ) : null}

      <ul className="space-y-2">
        {games.map((game, index) => (
          <li key={game.id}>
            {editing === game.id ? (
              form
            ) : (
              <Card quiet={!game.isActive} reveal={index}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>
                    {game.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{game.name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge tone="coral">{game.pointsPerWin} pts</Badge>
                      <Badge>
                        {game.mode === 'duel'
                          ? `${game.sidesCount} joueurs`
                          : game.mode === 'clash'
                            ? 'Les deux équipes'
                            : `${game.sidesCount} × ${game.playersPerSide}`}
                      </Badge>
                      {game.marginBonusEnabled ? (
                        <Badge tone="grape">+{game.marginBonusPerPoint}/écart</Badge>
                      ) : null}
                      {!game.isActive ? <Badge tone="tangerine">Archivé</Badge> : null}
                      <Badge>{game.matchCount} parties</Badge>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setDraft(toDraft(game));
                      setEditing(game.id);
                      setError(null);
                    }}
                  >
                    Modifier
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setGameArchived(game.id, game.isActive);
                        if (!result.ok) setError(result.message);
                        router.refresh();
                      })
                    }
                  >
                    {game.isActive ? 'Archiver' : 'Réactiver'}
                  </Button>
                </div>
              </Card>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
