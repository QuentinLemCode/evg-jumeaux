import type { CardAccent } from '@/components/ui/Card';

/**
 * `teams.accent` is a Confetti token stored as text, so that the two teams
 * differ by colour as well as by name (spec 0017, data model). It is narrowed
 * here rather than trusted: a typo in a seed must not reach a `className`.
 */
const ACCENTS: CardAccent[] = ['coral', 'tangerine', 'grape', 'mint', 'sky'];

export function teamAccent(value: string): CardAccent {
  return ACCENTS.includes(value as CardAccent) ? (value as CardAccent) : 'sky';
}

/**
 * The sticker utility for a team's accent, written out in full: Tailwind reads
 * the source, so a class assembled from a variable is a class that never gets
 * generated.
 */
const STICKERS: Record<CardAccent, string> = {
  coral: 'sticker-coral',
  tangerine: 'sticker-tangerine',
  grape: 'sticker-grape',
  mint: 'sticker-mint',
  sky: 'sticker-sky',
};

export function teamSticker(value: string): string {
  return STICKERS[teamAccent(value)];
}
