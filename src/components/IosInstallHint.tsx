'use client';

import { useEffect, useState } from 'react';

import { detectPlatform, isStandalone } from '@/lib/push-client';

import { AlertIcon, ChevronRightIcon, ShareIcon } from './ui/Icon';

const STEPS = [
  'Ouvre le site dans Safari (Chrome sur iPhone ne sait pas installer l’app).',
  'Touche le bouton Partager, en bas de l’écran.',
  'Fais défiler, choisis « Sur l’écran d’accueil », puis Ajouter.',
  'Ouvre l’app depuis ton écran d’accueil et connecte-toi là.',
];

/**
 * Shown on the LOGIN screen, before anyone signs in (spec 0006, rule 2b).
 *
 * The placement is the whole point: an installed iOS web app has its own
 * cookie jar, so someone who logs in in Safari and then installs has to enter
 * their PIN again inside the app. Telling them after login is telling them too
 * late. The instructions are inline rather than a link because `/install` is
 * behind authentication.
 *
 * It renders for nobody else: on Android, on desktop, or once the app is
 * installed, there is nothing to say here.
 */
export function IosInstallHint() {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setShow(detectPlatform() === 'ios-safari' && !isStandalone());
  }, []);

  if (!show) return null;

  return (
    <div className="sticker sticker-tangerine mb-4 p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="tap-target flex w-full items-start gap-2.5 text-left"
      >
        <span className="mt-0.5 shrink-0 text-tangerine-deep">
          <AlertIcon size={20} strokeWidth={2.2} />
        </span>
        <span className="flex-1 text-xs leading-snug">
          <span className="font-bold">Sur iPhone&nbsp;?</span> Ajoute l’app à ton écran
          d’accueil <span className="font-bold">avant</span> de te connecter — sinon il
          faudra recommencer dedans.
          <span className="mt-1 flex items-center gap-1 font-bold text-tangerine-deep underline">
            {open ? 'Masquer' : 'Voir comment'}
            <ChevronRightIcon
              size={13}
              strokeWidth={2.6}
              className={open ? 'rotate-90 transition-transform' : 'transition-transform'}
            />
          </span>
        </span>
      </button>

      {open ? (
        <ol className="mt-3 flex flex-col gap-2 border-t-2 border-tangerine/40 pt-3">
          {STEPS.map((step, index) => (
            <li key={step} className="flex items-start gap-2.5">
              <span className="display mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-tangerine text-[11px] font-black text-ink">
                {index + 1}
              </span>
              <span className="flex-1 text-xs leading-snug">
                {index === 1 ? (
                  <span className="flex flex-wrap items-center gap-1">
                    Touche
                    <span className="pill inline-flex items-center gap-1 bg-surface px-2 py-0.5 font-bold">
                      <ShareIcon size={13} strokeWidth={2.2} />
                      Partager
                    </span>
                    , en bas de l’écran.
                  </span>
                ) : (
                  step
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="mt-2.5 text-[11px] leading-snug text-tangerine-deep">
        Sur iPhone, les alertes ne fonctionnent que depuis l’app installée, et il faut
        iOS 16.4 ou plus récent. C’est une limite d’iOS, pas de l’app.
      </p>
    </div>
  );
}
