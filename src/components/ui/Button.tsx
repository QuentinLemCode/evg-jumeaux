import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Buttons are stickers too (spec 0010 §2): ink border, 18px radius, hard
 * `3px 5px 0` shadow, Gabarito label. `danger` is deliberately an OUTLINE
 * sticker rather than a filled one — the primary action and a destructive
 * action must not look identical, and in this palette they share a hue.
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'sticker-button bg-coral text-bg hover:bg-coral-deep',
  secondary: 'sticker-button bg-surface text-ink hover:bg-bg',
  ghost: 'display font-bold text-muted hover:text-ink',
  danger: 'sticker-button border-coral bg-surface text-coral-deep shadow-coral hover:bg-coral-tint',
  success: 'sticker-button bg-mint text-bg hover:brightness-105',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-4 py-3',
  lg: 'px-5 py-4 text-lg',
};

function classes(variant: Variant, size: Size, full: boolean, extra?: string) {
  return [
    'tap-target inline-flex items-center justify-center gap-2 transition-colors select-none',
    'disabled:pointer-events-none disabled:opacity-40',
    VARIANTS[variant],
    SIZES[size],
    full ? 'w-full' : '',
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant = 'primary',
  size = 'md',
  full = false,
  className,
  children,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size; full?: boolean }) {
  return (
    <button className={classes(variant, size, full, className)} {...props}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  full = false,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  full?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={classes(variant, size, full, className)}>
      {children}
    </Link>
  );
}
