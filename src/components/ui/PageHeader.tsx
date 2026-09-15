import type { ReactNode } from 'react';

/**
 * Every screen's title (spec 0010 §8, rule 1).
 *
 * The explicit line-height is not decoration: a fallback face resolving a
 * taller default silently pushes the bottom of a 390×844 screen out of view.
 */
export function PageHeader({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Anything that belongs directly under the header, e.g. a view switch. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="display text-3xl leading-[1.06] font-black tracking-tight text-pretty">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm leading-snug font-medium text-muted">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </header>
  );
}
