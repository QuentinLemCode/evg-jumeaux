import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/cookie';

/**
 * Remembers where a guest was going (spec 0001, rule 7).
 *
 * `requireUser(returnTo)` in each page cannot do this on its own: the `(app)`
 * layout guards the whole group and renders BEFORE the page, so its own
 * `requireUser()` — which has no path to pass — always wins the race and
 * redirects to a bare `/`. Every `returnTo` a page passed was dead code.
 *
 * Middleware is the only place that knows the pathname before anything
 * renders. It checks for the PRESENCE of the session cookie and nothing more:
 * verifying the signature is still the pages' job, because a forged cookie
 * must not get past `requireUser`, and the edge runtime has no database.
 */
const PROTECTED = [
  '/admin',
  '/admin-log',
  '/e2e-crash',
  '/games',
  '/history',
  '/install',
  '/leaderboard',
  '/matches',
  '/notifications',
  '/players',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const guarded = PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!guarded) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const login = new URL('/', request.url);
  // The route only — a query string can carry another `next=`, and chaining
  // those is how an open redirect gets built.
  login.searchParams.set('next', pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/admin',
    '/admin-log/:path*',
    '/admin-log',
    '/e2e-crash',
    '/games/:path*',
    '/games',
    '/history/:path*',
    '/history',
    '/install',
    '/leaderboard',
    '/matches/:path*',
    '/notifications',
    '/players/:path*',
  ],
};
