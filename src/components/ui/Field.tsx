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
    // data-testid, because Next injects its own role="alert" route announcer
    // into every page: getByRole('alert') is ambiguous by construction.
    <p
      role="alert"
      data-testid="form-error"
      className="sticker sticker-coral px-3 py-2 text-sm font-semibold text-coral-deep"
    >
      {children}
    </p>
  );
}

/**
 * A labelled group of controls that are NOT a single form input — a row of
 * choice buttons, typically.
 *
 * `Field` cannot do this: it renders a `<label>`, and `<button>` is a
 * labelable element, so the label binds to the FIRST button in the group and
 * overrides its accessible name. The button then announces itself as "Format"
 * instead of "Chacun pour soi" — to a screen reader and to a test alike.
 */
export function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <span className="display mb-1.5 block text-xs font-bold tracking-wide text-muted uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-faint">{hint}</span> : null}
    </div>
  );
}
