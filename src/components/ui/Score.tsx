/**
 * Every number in the app (spec 0010 §8, rule 5).
 *
 * Gabarito, black weight, tabular figures — so a column of scores lines up and
 * a result never reads as a form field. Going through one component is what
 * makes "Gabarito on every number" true rather than aspirational.
 */
const TONES = {
  ink: 'text-ink',
  muted: 'text-muted',
  coral: 'text-coral',
  tangerine: 'text-tangerine',
  grape: 'text-grape',
  mint: 'text-mint',
  sky: 'text-sky',
  gold: 'text-medal-gold',
  silver: 'text-medal-silver',
  bronze: 'text-medal-bronze',
} as const;

const SIZES = {
  sm: 'text-sm',
  md: 'text-xl',
  lg: 'text-2xl',
  xl: 'text-4xl',
} as const;

export type ScoreTone = keyof typeof TONES;

export function Score({
  value,
  tone = 'ink',
  size = 'md',
  suffix,
  className,
}: {
  value: number | string;
  tone?: ScoreTone;
  size?: keyof typeof SIZES;
  /** A unit shown at half weight beside the figure, e.g. "pts". */
  suffix?: string;
  className?: string;
}) {
  return (
    <span
      className={[
        'display font-black tabular-nums tracking-tight',
        SIZES[size],
        TONES[tone],
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {value}
      {suffix ? (
        <span className="ml-0.5 text-[11px] font-bold tracking-normal">{suffix}</span>
      ) : null}
    </span>
  );
}

/** A signed delta: green when it adds, coral when it takes away. */
export function Delta({
  points,
  size = 'md',
}: {
  points: number;
  size?: keyof typeof SIZES;
}) {
  return (
    <Score
      value={points > 0 ? `+${points}` : String(points)}
      tone={points > 0 ? 'mint' : points < 0 ? 'coral' : 'muted'}
      size={size}
    />
  );
}
