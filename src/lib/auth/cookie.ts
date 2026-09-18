/**
 * The session cookie's name, and nothing else.
 *
 * Its own module because `middleware.ts` needs it and runs on the edge
 * runtime: importing it from `session.ts` would drag in `next/headers` and the
 * env validation, neither of which exists there.
 */
export const SESSION_COOKIE = 'evg_session';
