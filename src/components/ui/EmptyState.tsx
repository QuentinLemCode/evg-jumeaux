import type { ReactNode } from 'react';

/**
 * Every list that can be empty has a designed empty state
 * (AGENTS.md §5, spec 0007 criterion).
 *
 * `illustration` is a large decorative emoji, not an icon: it carries no
 * state, is never tapped, and reads as a drawing at 40px. Interface icons are
 * drawn SVG (spec 0010 §5).
 */
export function EmptyState({
  illustration,
  title,
  children,
  action,
}: {
  illustration: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-border px-6 py-10 text-center">
      <div className="mb-3 text-4xl" aria-hidden>
        {illustration}
      </div>
      <p className="font-medium">{title}</p>
      {children ? <p className="mt-1 text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
