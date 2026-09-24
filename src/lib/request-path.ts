/**
 * Where the guest was going, carried from the middleware to the layout.
 *
 * A player with no team is sent to the team-choice screen from ANY app URL
 * and then back to where they were heading (spec 0017, rule 11). The `(app)`
 * layout is what performs that redirect, and a server component has no
 * pathname of its own: the middleware is the only place that knows it before
 * anything renders, so it stamps it on the request.
 *
 * Its own module, and not `middleware.ts`, so that importing the constant
 * from a page does not drag the edge-runtime middleware into the bundle.
 */
export const PATHNAME_HEADER = 'x-evg-pathname';

/** Only a same-site route may be used as a destination — never a full URL. */
export function safeDestination(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
