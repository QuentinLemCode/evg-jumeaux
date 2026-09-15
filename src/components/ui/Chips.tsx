import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Filters and view switches (spec 0010 §8, rules 7 and 9).
 *
 * The row SCROLLS rather than clipping: a chip sheared off flat against the
 * gutter reads as a rendering bug, and it happened once already.
 */
export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="chip-row -mx-1 px-1 pb-1">{children}</div>;
}

export function ChipLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={[
        'pill tap-target inline-flex shrink-0 items-center gap-1.5 px-3 text-sm font-semibold',
        active ? 'bg-ink text-bg' : 'bg-surface text-muted hover:bg-bg',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}

/** Two or three mutually exclusive views of the same screen. */
export function ViewSwitch({
  views,
}: {
  views: { href: string; label: string; active: boolean }[];
}) {
  return (
    <div className="pill inline-flex gap-1 bg-surface p-1">
      {views.map((view) => (
        <Link
          key={view.href}
          href={view.href}
          aria-current={view.active ? 'page' : undefined}
          className={[
            'tap-target display inline-flex items-center rounded-full px-4 text-sm font-bold',
            view.active ? 'bg-ink text-bg' : 'text-muted hover:text-ink',
          ].join(' ')}
        >
          {view.label}
        </Link>
      ))}
    </div>
  );
}
