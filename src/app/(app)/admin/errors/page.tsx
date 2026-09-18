import { ClientErrorControls } from '@/components/admin/ClientErrorControls';
import { PlayerLink } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ChipLink, ChipRow } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Score } from '@/components/ui/Score';
import { requireAdmin } from '@/lib/auth/guards';
import type { ClientErrorKind } from '@/lib/domain/client-errors';
import { dateTime, relativeTime } from '@/lib/format';
import { listClientErrors } from '@/lib/queries/client-errors';

export const dynamic = 'force-dynamic';

/**
 * Browser failures, grouped (spec 0011, rules 16-18).
 *
 * Admin-only: a stack trace exposes internal structure and a guest can act on
 * none of it.
 */
const KIND_LABELS: Record<ClientErrorKind, string> = {
  render: 'Écran planté',
  unhandled: 'Exception',
  rejection: 'Promesse rejetée',
  sw: 'Service worker',
};

const KIND_TONES: Record<ClientErrorKind, 'coral' | 'tangerine' | 'grape' | 'sky'> = {
  render: 'coral',
  unhandled: 'tangerine',
  rejection: 'grape',
  sw: 'sky',
};

export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  await requireAdmin('/admin/errors');
  const { all } = await searchParams;
  const includeResolved = all === '1';
  const groups = await listClientErrors({ includeResolved });

  return (
    <div>
      <PageHeader
        title="Erreurs navigateur"
        subtitle="Ce qui casse chez les joueurs, regroupé par cause."
      />

      <ChipRow>
        <ChipLink href="/admin/errors" active={!includeResolved}>
          Ouvertes
        </ChipLink>
        <ChipLink href="/admin/errors?all=1" active={includeResolved}>
          Tout, traitées incluses
        </ChipLink>
      </ChipRow>

      {groups.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            illustration="🌤️"
            title={includeResolved ? 'Aucune erreur signalée' : 'Aucune erreur ouverte'}
          >
            {includeResolved
              ? 'Aucun navigateur n’a remonté d’erreur. C’est bon signe.'
              : 'Tout ce qui a été signalé est traité.'}
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2.5">
          {groups.map((group, index) => (
            <li key={group.fingerprint} data-testid="client-error" data-kind={group.kind}>
              <Card className="p-3" quiet={group.resolvedAt !== null} reveal={index}>
                <div className="flex items-start gap-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={KIND_TONES[group.kind]}>{KIND_LABELS[group.kind]}</Badge>
                      {group.resolvedAt !== null ? <Badge tone="mint">Traitée</Badge> : null}
                      <code className="text-[11px] text-faint">{group.path}</code>
                    </span>
                    <span className="display mt-1.5 block text-sm leading-snug font-bold">
                      {group.message}
                    </span>
                  </span>
                  <span className="text-right">
                    <Score value={group.occurrences} tone="coral" size="md" />
                    <span className="block text-[11px] text-faint">
                      {group.occurrences > 1 ? 'fois' : 'fois'}
                    </span>
                  </span>
                </div>

                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <div>
                    <dt className="text-muted">Navigateur</dt>
                    <dd className="font-semibold">{group.lastBrowser ?? 'inconnu'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Joueur</dt>
                    <dd className="font-semibold">
                      {group.lastUserId && group.lastUserName ? (
                        <PlayerLink userId={group.lastUserId} name={group.lastUserName} />
                      ) : (
                        'non connecté'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Vu pour la dernière fois</dt>
                    <dd className="font-semibold">
                      {relativeTime(group.lastSeenAt)}
                      <span className="font-normal text-faint"> · {dateTime(group.lastSeenAt)}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Première fois</dt>
                    <dd className="font-semibold">{dateTime(group.firstSeenAt)}</dd>
                  </div>
                  {group.viewport ? (
                    <div>
                      <dt className="text-muted">Écran</dt>
                      <dd className="font-semibold">{group.viewport}</dd>
                    </div>
                  ) : null}
                  {group.appCommit ? (
                    <div>
                      <dt className="text-muted">Version</dt>
                      <dd className="font-semibold">{group.appCommit.slice(0, 7)}</dd>
                    </div>
                  ) : null}
                </dl>

                {group.stack ? (
                  <details className="mt-2.5">
                    <summary className="tap-target display flex cursor-pointer items-center text-xs font-bold text-muted">
                      Trace d’appel
                    </summary>
                    {/* The one place a raw trace belongs: behind a disclosure,
                        on an admin screen (spec 0011, rules 14 and 17). */}
                    <pre className="mt-1.5 overflow-x-auto rounded-xl border-2 border-hairline bg-bg-elevated p-2.5 text-[11px] leading-relaxed">
                      {group.stack}
                    </pre>
                  </details>
                ) : null}

                <ClientErrorControls
                  fingerprint={group.fingerprint}
                  resolved={group.resolvedAt !== null}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
