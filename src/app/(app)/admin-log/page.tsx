import Link from 'next/link';

import { LiveRefresh } from '@/components/LiveRefresh';
import { ChipLink, ChipRow, ViewSwitch } from '@/components/ui/Chips';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  ClockIcon,
  EyeIcon,
  ScalesIcon,
  ScarfIcon,
  SlidersIcon,
  UndoIcon,
  type IconProps,
} from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { Delta } from '@/components/ui/Score';
import { requireUser } from '@/lib/auth/guards';
import { dateTime, relativeTime } from '@/lib/format';
import {
  ADMIN_LOG_LABELS,
  ADMIN_LOG_TYPES,
  listAdminLog,
  type AdminLogType,
} from '@/lib/queries/admin-log';

export const dynamic = 'force-dynamic';

/**
 * The public admin log (spec 0008, rules 15-21). Readable by every player, not
 * only admins: a fix nobody can see is indistinguishable from cheating.
 */
const MARKS: Record<
  AdminLogType,
  { Icon: (props: IconProps) => React.ReactElement; tint: string; ink: string }
> = {
  adjustment: { Icon: SlidersIcon, tint: 'bg-sky-tint', ink: 'text-sky' },
  dispute_settled: { Icon: ScalesIcon, tint: 'bg-grape-tint', ink: 'text-grape' },
  match_cancelled: { Icon: UndoIcon, tint: 'bg-coral-tint', ink: 'text-coral' },
  force_expired: { Icon: ClockIcon, tint: 'bg-tangerine-tint', ink: 'text-tangerine-deep' },
  scarf_theft: { Icon: ScarfIcon, tint: 'bg-coral-tint', ink: 'text-coral' },
};

function isLogType(value: string | undefined): value is AdminLogType {
  return value !== undefined && (ADMIN_LOG_TYPES as readonly string[]).includes(value);
}

export default async function AdminLogPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireUser('/admin-log');
  const { type } = await searchParams;
  const filter = isLogType(type) ? type : undefined;
  const entries = await listAdminLog(filter);

  return (
    <div>
      <LiveRefresh />

      <PageHeader
        title="Journal des admins"
        subtitle="Chaque intervention sur les scores, avec son motif."
      >
        <ViewSwitch
          views={[
            { href: '/history', label: 'Parties', active: false },
            { href: '/admin-log', label: 'Journal', active: true },
          ]}
        />
      </PageHeader>

      {/* The transparency contract, stated on the screen itself. */}
      <Card accent="mint" className="mb-4 flex items-center gap-3 p-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-mark border-2 border-mint bg-surface text-mint-deep">
          <EyeIcon size={18} strokeWidth={2.2} />
        </span>
        <p className="text-xs leading-snug">
          <span className="font-bold">Visible par tout le monde.</span> Aucun point ne bouge
          sans apparaître ici.
        </p>
      </Card>

      <ChipRow>
        <ChipLink href="/admin-log" active={filter === undefined}>
          Tout
        </ChipLink>
        {ADMIN_LOG_TYPES.map((logType) => (
          <ChipLink
            key={logType}
            href={filter === logType ? '/admin-log' : `/admin-log?type=${logType}`}
            active={filter === logType}
          >
            {ADMIN_LOG_LABELS[logType]}
          </ChipLink>
        ))}
      </ChipRow>

      {entries.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            illustration="🕊️"
            title={filter ? 'Rien de ce type' : 'Aucune intervention'}
          >
            {filter
              ? 'Aucune intervention de ce type pour le moment.'
              : 'Les admins n’ont touché à aucun score. C’est bon signe.'}
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2.5">
          {entries.map((entry, index) => {
            const mark = MARKS[entry.type];
            return (
              <li key={entry.key} data-testid="admin-log-entry" data-kind={entry.type}>
                <Card className="p-3" reveal={index}>
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-mark border-2 border-ink ${mark.tint} ${mark.ink}`}
                    >
                      <mark.Icon size={18} strokeWidth={2.2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="display block text-sm font-bold">
                        {ADMIN_LOG_LABELS[entry.type]}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {entry.adminName} · <time dateTime={new Date(entry.at).toISOString()}>{relativeTime(entry.at)}</time>
                        <span className="text-faint"> · {dateTime(entry.at)}</span>
                      </span>
                    </span>
                    <Delta points={entry.points} />
                  </div>

                  <p className="mt-2.5 text-xs leading-relaxed">
                    {entry.gameName ? (
                      <span className="font-semibold">{entry.gameName} · </span>
                    ) : null}
                    {entry.targetUserId ? (
                      <Link href={`/players/${entry.targetUserId}`} className="font-semibold underline">
                        {entry.subject}
                      </Link>
                    ) : (
                      <span>{entry.subject}</span>
                    )}
                    {entry.affected > 1 ? (
                      <span className="text-muted"> — réparti sur {entry.affected} joueurs</span>
                    ) : null}
                  </p>

                  {/* The reason is always shown in full, never folded behind a
                      disclosure control (spec 0008, rule 18). */}
                  {entry.reason ? (
                    <p className="mt-1.5 border-l-[3px] border-hairline pl-2.5 text-xs leading-relaxed text-muted italic">
                      «&nbsp;{entry.reason}&nbsp;»
                    </p>
                  ) : entry.derived ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">{entry.derived}</p>
                  ) : null}

                  {entry.matchId ? (
                    <Link
                      href={`/matches/${entry.matchId}`}
                      className="mt-2 inline-block text-xs font-semibold text-coral underline"
                    >
                      Voir la partie →
                    </Link>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
