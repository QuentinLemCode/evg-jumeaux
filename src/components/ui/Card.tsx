import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { reveal } from './reveal';

/**
 * The sticker card (spec 0010 §2): 3px ink border, 20px radius, hard offset
 * shadow. The `sticker` utility owns those three values so a card cannot
 * drift; an accent card takes the accent for its border AND its shadow via
 * `sticker-<accent>`.
 */
export type CardAccent = 'coral' | 'tangerine' | 'grape' | 'mint' | 'sky';

const ACCENTS: Record<CardAccent, string> = {
  coral: 'sticker-coral',
  tangerine: 'sticker-tangerine',
  grape: 'sticker-grape',
  mint: 'sticker-mint',
  sky: 'sticker-sky',
};

/**
 * `reveal` takes the card's position in its list and joins the screen's single
 * entrance sequence (spec 0010 §8, rule 10). It is a prop rather than a spread
 * so that a card cannot accidentally lose its own classes to it.
 */
type RevealProps = { reveal?: number; revealKind?: 'rise' | 'pop' };

function cardStyle(props: RevealProps): CSSProperties | undefined {
  return props.reveal === undefined ? undefined : reveal(props.reveal, props.revealKind).style;
}

function cardClass(
  accent: CardAccent | undefined,
  quiet: boolean,
  props: RevealProps,
  extra?: string,
) {
  return [
    'sticker p-4',
    accent ? ACCENTS[accent] : '',
    quiet ? 'sticker-quiet' : '',
    props.reveal === undefined ? '' : reveal(props.reveal, props.revealKind).className,
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Card({
  children,
  className,
  accent,
  quiet = false,
  ...revealProps
}: {
  children: ReactNode;
  className?: string;
  accent?: CardAccent;
  quiet?: boolean;
} & RevealProps) {
  return (
    <div className={cardClass(accent, quiet, revealProps, className)} style={cardStyle(revealProps)}>
      {children}
    </div>
  );
}

export function CardLink({
  href,
  children,
  className,
  accent,
  quiet = false,
  ...revealProps
}: {
  href: string;
  children: ReactNode;
  className?: string;
  accent?: CardAccent;
  quiet?: boolean;
} & RevealProps) {
  return (
    <Link
      href={href}
      className={cardClass(
        accent,
        quiet,
        revealProps,
        ['block transition-colors hover:bg-bg', className ?? ''].join(' '),
      )}
      style={cardStyle(revealProps)}
    >
      {children}
    </Link>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="display text-xs font-bold tracking-widest text-muted uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}
