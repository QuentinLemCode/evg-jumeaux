import type { ReactNode } from 'react';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="display mb-1.5 block text-xs font-bold tracking-wide text-muted uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'tap-target sticker w-full px-3 py-3 text-ink placeholder:text-faint ' +
  'focus:border-grape focus:outline-none';

export function ErrorMessage({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="sticker sticker-coral px-3 py-2 text-sm font-semibold text-coral-deep">
      {children}
    </p>
  );
}
