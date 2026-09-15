'use client';

import { useEffect, useState } from 'react';

import { CheckIcon } from '@/components/ui/Icon';
import { savePushSubscription } from '@/lib/actions/push';
import {
  detectPlatform,
  isStandalone,
  needsInstallFirst,
  pushSupported,
  requestAndSubscribe,
  type PushPlatform,
} from '@/lib/push-client';

import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { ErrorMessage } from './ui/Field';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const IOS_STEPS = [
  'Ouvre le menu Partager (l’icône carrée avec une flèche, en bas de Safari).',
  'Fais défiler et touche « Sur l’écran d’accueil ».',
  'Valide avec « Ajouter ».',
  'Ouvre l’app depuis ton écran d’accueil, puis reviens ici activer les alertes.',
];

export function InstallInstructions({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [platform, setPlatform] = useState<PushPlatform | null>(null);
  const [installed, setInstalled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    'default',
  );
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setInstalled(isStandalone());
    setPermission(pushSupported() ? Notification.permission : 'unsupported');

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  async function enable() {
    setError(null);
    setBusy(true);
    try {
      if (!vapidPublicKey) {
        setError('Les alertes ne sont pas configurées sur le serveur.');
        return;
      }
      const result = await requestAndSubscribe(vapidPublicKey);
      if (result.status === 'granted') {
        const saved = await savePushSubscription(result.subscription);
        if (!saved.ok) {
          setError(saved.message);
          return;
        }
        setPermission('granted');
        return;
      }
      if (result.status === 'needs-install') {
        setError('Installe d’abord l’app sur ton écran d’accueil.');
        return;
      }
      if (result.status === 'denied') {
        setPermission('denied');
        setError(
          'Les alertes ont été bloquées. Autorise-les dans les réglages du navigateur, puis reviens ici.',
        );
        return;
      }
      if (result.status === 'unsupported') {
        setError('Ton navigateur ne gère pas les alertes.');
        return;
      }
      setError('L’abonnement a échoué. Réessaie.');
    } finally {
      setBusy(false);
    }
  }

  if (platform === null) {
    return <Card>Chargement…</Card>;
  }

  const mustInstall = needsInstallFirst();

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-semibold">Pourquoi activer les alertes ?</h2>
        <p className="mt-1.5 text-sm text-muted">
          Une invitation à jouer expire au bout de 5 minutes. Sans alerte, tu la
          découvriras trop tard. Tout reste aussi disponible dans l’onglet Alertes.
        </p>
      </Card>

      {permission === 'granted' ? (
        <Card className="border-mint/40 bg-mint/10">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckIcon size={18} strokeWidth={2.6} />
            Les alertes sont actives sur cet appareil
          </p>
          <p className="mt-1 text-sm text-muted">
            Tu peux les couper depuis les réglages de ton navigateur.
          </p>
        </Card>
      ) : null}

      {permission === 'unsupported' ? (
        <Card className="border-border">
          <p className="text-sm">
            Ton navigateur ne gère pas les alertes. Consulte l’onglet Alertes pour ne rien
            manquer.
          </p>
        </Card>
      ) : null}

      {/* iOS has no install API at all, so pretending otherwise would be a lie:
          the manual steps are the only path (spec 0009, rule 10). */}
      {platform === 'ios-safari' && !installed ? (
        <Card>
          <h2 className="font-semibold">Installe l’app (iPhone)</h2>
          <ol className="mt-2 space-y-2 text-sm text-muted">
            {IOS_STEPS.map((step, index) => (
              <li key={step} className="flex gap-2">
                <span className="font-bold text-coral">{index + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-faint">
            Sur iPhone, les alertes ne fonctionnent que depuis l’app installée. C’est une
            limite d’iOS, pas de l’app.
          </p>
        </Card>
      ) : null}

      {installEvent && !installed ? (
        <Card>
          <h2 className="font-semibold">Installe l’app</h2>
          <p className="mt-1 text-sm text-muted">
            Un raccourci sur ton écran d’accueil, sans passer par le navigateur.
          </p>
          <div className="mt-3">
            <Button
              full
              variant="secondary"
              onClick={async () => {
                await installEvent.prompt();
                const choice = await installEvent.userChoice;
                if (choice.outcome === 'accepted') setInstalled(true);
                setInstallEvent(null);
              }}
            >
              Installer maintenant
            </Button>
          </div>
        </Card>
      ) : null}

      {platform === 'android' && !installEvent && !installed ? (
        <Card>
          <h2 className="font-semibold">Installe l’app (Android)</h2>
          <p className="mt-1 text-sm text-muted">
            Menu ⋮ de Chrome → « Installer l’application » ou « Ajouter à l’écran
            d’accueil ».
          </p>
        </Card>
      ) : null}

      <ErrorMessage>{error}</ErrorMessage>

      {permission !== 'granted' && permission !== 'unsupported' ? (
        <div className="safe-bottom sticky bottom-20 md:bottom-4">
          <Button full size="lg" disabled={busy || mustInstall} onClick={enable}>
            {busy
              ? 'Activation…'
              : mustInstall
                ? 'Installe l’app d’abord'
                : 'Activer les alertes'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
