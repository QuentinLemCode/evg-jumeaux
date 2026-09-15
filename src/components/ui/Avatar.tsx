import Link from 'next/link';

const SIZES = {
  sm: 'size-8 text-base',
  md: 'size-10 text-xl',
  lg: 'size-16 text-3xl',
} as const;

export function Avatar({
  emoji,
  size = 'md',
  ring,
}: {
  emoji: string;
  size?: keyof typeof SIZES;
  ring?: 'gold' | 'silver' | 'bronze';
}) {
  // The medal is a ring on the avatar, not a glyph: it recolours and cannot
  // render differently per device (spec 0010 §5).
  const ringClass =
    ring === 'gold'
      ? 'ring-3 ring-medal-gold'
      : ring === 'silver'
        ? 'ring-3 ring-medal-silver'
        : ring === 'bronze'
          ? 'ring-3 ring-medal-bronze'
          : '';
  return (
    <span
      aria-hidden
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-bg',
        SIZES[size],
        ringClass,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {emoji}
    </span>
  );
}

/**
 * Every occurrence of a player's name links to their profile
 * (spec 0007, rule 9).
 */
export function PlayerLink({
  userId,
  name,
  avatar,
  className,
}: {
  userId: string;
  name: string;
  avatar?: string;
  className?: string;
}) {
  return (
    <Link
      href={`/players/${userId}`}
      className={['inline-flex items-center gap-2 hover:underline', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {avatar ? <Avatar emoji={avatar} size="sm" /> : null}
      <span className="truncate">{name}</span>
    </Link>
  );
}
