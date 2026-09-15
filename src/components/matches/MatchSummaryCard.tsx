import { Countdown } from '@/components/Countdown';
import { CrownIcon } from '@/components/ui/Icon';
import { Score } from '@/components/ui/Score';
import { StatusBadge } from '@/components/ui/Badge';
import { CardLink } from '@/components/ui/Card';
import { relativeTime } from '@/lib/format';
import type { MatchSummary } from '@/lib/queries/matches';

/**
 * One row in the live list and in the history (spec 0007, rules 3-4).
 * Cancelled and expired matches are shown, greyed: hiding them would let a
 * player quietly retry until they finally win one.
 */
export function MatchSummaryCard({
  match,
  highlight = false,
  reveal,
}: {
  match: MatchSummary;
  highlight?: boolean;
  /** Position in its list, for the screen's single entrance sequence. */
  reveal?: number;
}) {
  const over = match.status === 'cancelled' || match.status === 'expired';
  const timestamp = match.settledAt ?? match.createdAt;

  return (
    <CardLink
      href={`/matches/${match.id}`}
      quiet={over}
      accent={highlight ? 'coral' : undefined}
      reveal={reveal}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>
          {match.gameIcon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{match.gameName}</span>
            <StatusBadge status={match.status} />
          </div>

          <ul className="mt-2 space-y-1">
            {match.sides.map((side) => {
              const won = match.winningSide === side.sideIndex;
              return (
                <li key={side.sideIndex} className="flex items-baseline gap-2 text-sm">
                  <span
                    className={[
                      'flex min-w-0 flex-1 items-center gap-1.5 truncate',
                      won ? 'text-mint font-semibold' : 'text-muted',
                    ].join(' ')}
                  >
                    {won ? <CrownIcon size={15} /> : null}
                    <span className="truncate">{side.label}</span>
                  </span>
                  {side.score !== null ? (
                    <Score value={side.score} tone={won ? 'mint' : 'muted'} size="sm" />
                  ) : null}
                </li>
              );
            })}
          </ul>

          <p className="mt-2 text-xs text-faint">
            {match.status === 'pending' ? (
              <>
                Expire dans <Countdown deadline={match.invitationExpiresAt} />
              </>
            ) : (
              relativeTime(timestamp)
            )}
            {over && match.cancelReason ? ` · ${match.cancelReason}` : ''}
          </p>
        </div>
      </div>
    </CardLink>
  );
}
