import type { ReactNode } from 'react';

import { STATUS_LABELS } from '@/lib/format';

/**
 * A pill (spec 0010 §2): 2px ink border, fully rounded. Tones use the accent
 * tint as a fill and the `-deep` variant for text, so the label stays above
 * 4.5:1 on the tint.
 */
const TONES = {
  neutral: 'bg-bg-elevated text-muted',
  coral: 'bg-coral-tint text-coral-deep',
  tangerine: 'bg-tangerine-tint text-tangerine-deep',
  grape: 'bg-grape-tint text-grape',
  mint: 'bg-mint-tint text-mint-deep',
  sky: 'bg-sky-tint text-sky',
} as const;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span
      className={`pill display inline-flex items-center px-2 py-0.5 text-[11px] font-bold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, keyof typeof TONES> = {
  pending: 'tangerine',
  active: 'coral',
  awaiting_validation: 'grape',
  disputed: 'coral',
  completed: 'mint',
  cancelled: 'neutral',
  expired: 'neutral',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status}</Badge>
  );
}
