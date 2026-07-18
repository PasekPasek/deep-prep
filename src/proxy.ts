import { NextResponse } from 'next/server';

import { auth } from '@/auth';

/**
 * Route protection. In Next 16 this file replaces middleware.ts.
 *
 * Two kinds of caller exist:
 *   - the browser, which must carry a session;
 *   - the app itself, when one pipeline step triggers the next. Those requests have no
 *     session and never will, so they authenticate with CRON_SECRET instead.
 *
 * Everything else is denied, including API routes — a session-less fetch to
 * /api/reviews must not read the card pool.
 */

/** Paths the app calls internally, authenticated by shared secret rather than session. */
const INTERNAL_PATHS = ['/api/pipeline/step', '/api/cron'];

function hasCronSecret(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const provided =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';

  // Length-independent comparison, so timing does not leak the secret's length.
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export const proxy = auth((request) => {
  const { pathname } = request.nextUrl;

  if (INTERNAL_PATHS.some((path) => pathname.startsWith(path))) {
    return hasCronSecret(request)
      ? NextResponse.next()
      : NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Auth.js routes and the login page stay public, or sign-in could never happen.
  if (pathname === '/login' || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  if (!request.auth?.user) {
    // API callers get a status they can act on; browsers get sent to sign in.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const login = new URL('/login', request.nextUrl.origin);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
});

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
