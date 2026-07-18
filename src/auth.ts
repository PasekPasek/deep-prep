import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Single-user auth (CLAUDE.md §8).
 *
 * There is no user table and no roles: exactly one email may sign in. Anyone else
 * authenticating with Google is rejected in the signIn callback, so an attacker who
 * reaches the OAuth flow still gets nothing.
 *
 * Defence in depth, in order of how much they'd have to defeat:
 *   1. Google OAuth consent screen stays in Testing mode with one test user.
 *   2. signIn callback compares against ALLOWED_EMAIL and requires email_verified.
 *   3. proxy.ts requires a session for every route except /login.
 *   4. No client-side database access at all — the service-role key never leaves the
 *      server, so a session alone grants no direct data access.
 */

function allowedEmail(): string {
  const email = process.env.ALLOWED_EMAIL;
  if (!email) {
    // Failing closed matters more than starting: without this the callback below would
    // compare against undefined and could admit anyone.
    throw new Error('ALLOWED_EMAIL is not set — refusing to start auth with no allowlist');
  }
  return email.toLowerCase();
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    signIn({ profile, account }) {
      if (account?.provider !== 'google') return false;

      // email_verified guards against a provider account claiming an address it does
      // not control; without it, the allowlist compares an unverified string.
      if (profile?.email_verified !== true) return false;

      return typeof profile.email === 'string' && profile.email.toLowerCase() === allowedEmail();
    },

    // Route protection lives here so both proxy.ts and any server component that calls
    // auth() share one definition of "allowed".
    authorized({ auth: session, request }) {
      const { pathname } = request.nextUrl;
      if (pathname === '/login' || pathname.startsWith('/api/auth')) return true;
      return Boolean(session?.user);
    },
  },
  session: { strategy: 'jwt' },
});
