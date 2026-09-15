'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { login } from '@/lib/actions/auth';
import { countdown } from '@/lib/format';
import type { RosterEntry } from '@/lib/queries/roster';

import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { ErrorMessage } from './ui/Field';
import { BackspaceIcon, ChevronRightIcon, SearchIcon } from './ui/Icon';
import { reveal } from './ui/reveal';

const PIN_LENGTH = 6;

export function LoginForm({
  roster,
  next,
}: {
  roster: RosterEntry[];
  next: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [search, setSearch] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Epoch ms until which the keypad stays disabled (spec 0001, rule 12). */
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);

  // The countdown ticks client-side and re-enables the keypad by itself: a
  // dead keypad with no explanation is worse than the lockout it enforces.
  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = () => {
      const left = lockedUntil - Date.now();
      setRemainingMs(left);
      if (left <= 0) {
        setLockedUntil(null);
        setError(null);
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  const locked = lockedUntil !== null && remainingMs > 0;

  const filtered = roster.filter((player) =>
    player.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function submit(userId: string, code: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('userId', userId);
      formData.set('pin', code);
      if (next) formData.set('next', next);

      const result = await login(formData);
      if (!result.ok) {
        setError(result.message);
        setPin('');
        if (result.retryInMs !== undefined) {
          setLockedUntil(Date.now() + result.retryInMs);
        }
        return;
      }
      router.replace(result.next);
    });
  }

  function press(digit: string) {
    if (!selected || pending || locked) return;
    const code = (pin + digit).slice(0, PIN_LENGTH);
    setPin(code);
    // Submits on the sixth digit: nobody should have to find a button
    // one-handed (spec 0001, rule 4).
    if (code.length === PIN_LENGTH) submit(selected.id, code);
  }

  if (!selected) {
    return (
      <div className="flex flex-col gap-2.5">
        <label className="sticker tap-target flex items-center gap-2.5 px-3">
          <SearchIcon size={18} className="shrink-0 text-muted" strokeWidth={2.2} />
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Cherche ton prénom"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full border-0 bg-transparent py-3 placeholder:text-faint focus:outline-none"
            aria-label="Cherche ton prénom"
          />
        </label>

        <ul className="no-scrollbar flex max-h-[46dvh] flex-col gap-2 overflow-y-auto">
          {filtered.map((player, index) => (
            <li key={player.id}>
              <button
                type="button"
                onClick={() => {
                  setSelected(player);
                  setPin('');
                  setError(null);
                }}
                className={`sticker tap-target flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-bg ${reveal(index).className}`}
                style={reveal(index).style}
              >
                <Avatar emoji={player.avatar} />
                <span className="display flex-1 text-base font-bold">{player.name}</span>
                <ChevronRightIcon size={17} className="text-faint" strokeWidth={2.6} />
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted">Aucun prénom ne correspond.</li>
          ) : null}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={() => {
          setSelected(null);
          setPin('');
          setError(null);
        }}
        className="sticker tap-target flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <Avatar emoji={selected.avatar} />
        <span className="display flex-1 text-base font-bold">{selected.name}</span>
        <span className="text-sm font-semibold text-grape">Changer</span>
      </button>

      <div className="flex justify-center gap-2.5" aria-label="Code à 6 chiffres">
        {Array.from({ length: PIN_LENGTH }).map((_, index) => (
          <span
            key={index}
            className={[
              'size-3.5 rounded-full transition-colors',
              index < pin.length ? 'bg-grape' : 'bg-hairline',
            ].join(' ')}
          />
        ))}
      </div>

      <ErrorMessage>{error}</ErrorMessage>

      {locked ? (
        <p
          role="status"
          aria-live="polite"
          className="sticker sticker-tangerine px-3 py-3 text-center text-sm font-semibold text-tangerine-deep"
        >
          Réessaie dans{' '}
          <span className="display tabular-nums">{countdown(remainingMs)}</span>
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <Button
            key={digit}
            variant="secondary"
            size="lg"
            disabled={locked || pending}
            onClick={() => press(digit)}
            className="display text-2xl font-bold"
          >
            {digit}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="lg"
          disabled={locked || pending}
          onClick={() => setPin('')}
          aria-label="Effacer le code"
        >
          Effacer
        </Button>
        <Button
          variant="secondary"
          size="lg"
          disabled={locked || pending}
          onClick={() => press('0')}
          className="display text-2xl font-bold"
        >
          0
        </Button>
        <Button
          variant="ghost"
          size="lg"
          disabled={locked || pending}
          onClick={() => setPin(pin.slice(0, -1))}
          aria-label="Supprimer le dernier chiffre"
        >
          <BackspaceIcon size={22} />
        </Button>
      </div>

      {pending ? <p className="text-center text-sm text-muted">Connexion…</p> : null}
      {!locked ? (
        <p className="text-center text-xs text-faint">Ça part tout seul au 6ᵉ chiffre.</p>
      ) : null}
    </div>
  );
}
