'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { BellIcon, CloseIcon } from '@/components/ui/Icon';
import { savePushSubscription } from '@/lib/actions/push';
import {
  getExistingSubscription,
  needsInstallFirst,
  pushSupported,
} from '@/lib/push-client';

const DISMISS_KEY = 'evg:push-banner-dismissed';

/**
 * Two jobs (spec 0006, rules 2-3):
 *
 *  - when permission is already granted, quietly make sure this device's
 *    subscription is on file (it changes when the browser rotates it);
 *  - otherwise, nudge towards the explanation screen. It never triggers the
 *    browser prompt itself — a prompt that appears on page load gets dismissed
 *    reflexively, and on iOS it cannot succeed at all outside an installed PWA.
 */
export function PushPrompt({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<'checking' | 'hidden' | 'invite' | 'denied'>(
    'checking',
  );

  useEffect(() => {
    if (!vapidPublicKey || !pushSupported()) {
      setState('hidden');
      return;
    }

    let cancelled = false;

    const sync = async () => {
      if (Notification.permission === 'granted') {
        try {
          const subscription = await getExistingSubscription(vapidPublicKey);
          if (subscription) await savePushSubscription(subscription);
        } catch {
          // A failed re-subscription is not worth bothering the player about:
          // the in-app inbox still works (spec 0006, rule 1).
        }
        if (!cancelled) setState('hidden');
        return;
      }

      const dismissed = sessionStorage.getItem(DISMISS_KEY) === '1';
      if (!cancelled) {
        if (dismissed) setState('hidden');
        else setState(Notification.permission === 'denied' ? 'denied' : 'invite');
      }
    };

    void sync();
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  if (state === 'checking' || state === 'hidden') return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setState('hidden');
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-card border border-coral/30 bg-coral/10 p-3">
      <span className="text-tangerine-deep">
        <BellIcon size={20} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {state === 'denied' ? (
          <p>
            Tu ne recevras pas d’alertes. Les invitations restent dans l’onglet{' '}
            <Link href="/notifications" className="underline">
              Alertes
            </Link>
            .
          </p>
        ) : (
          <p>
            Active les alertes pour ne pas manquer un défi — une invitation expire en 5
            minutes.
          </p>
        )}
        <Link
          href="/install"
          className="mt-2 inline-block font-medium text-coral underline"
        >
          {needsInstallFirst() ? 'Installer l’app' : 'Comment faire'}
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Masquer ce message"
        className="tap-target -mt-1 -mr-1 flex items-center justify-center px-2 text-muted"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
