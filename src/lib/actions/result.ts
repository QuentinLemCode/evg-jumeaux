/**
 * The shape every Server Action returns. Errors are values, not exceptions:
 * a player entering a score on a flaky 4G connection should see a French
 * sentence, not an error boundary.
 */
export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; message: string };

export function ok(): ActionResult;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T> {
  return { ok: true, data } as ActionResult<T>;
}

export function err<T = undefined>(message: string): ActionResult<T> {
  return { ok: false, message };
}

/** Wraps an action body so an unexpected throw becomes a readable message. */
export async function guarded<T>(
  body: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthorisationError') {
      return err<T>(error.message);
    }
    // Next.js signals redirects by throwing; never swallow those.
    if (
      typeof error === 'object' &&
      error !== null &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_')
    ) {
      throw error;
    }
    console.error('action failed', error);
    return err<T>('Une erreur est survenue. Réessaie.');
  }
}
