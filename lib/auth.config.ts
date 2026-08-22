import GoogleProvider from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

// Edge-safe half of the auth configuration.
//
// middleware.ts runs in the edge runtime and only ever READS an existing
// session, so it builds its own NextAuth instance from this config alone.
// That keeps Prisma and the Resend SDK — which pulls in node:stream and
// cannot be bundled for edge — out of the middleware bundle entirely.
//
// lib/auth.ts spreads this and adds everything that needs Node: the Prisma
// adapter, the magic-link provider, and the callbacks that read the database.
// Both instances share AUTH_SECRET, so the cookie one issues the other
// verifies.

export const authSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  (process.env.NODE_ENV === "development" ? "local-dev-auth-secret-change-me" : undefined);

// Total session lifetime. Well short of NextAuth's 30-day default: a stale
// token is the one thing standing between "removed in the user admin" and
// "actually locked out".
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export const authConfig = {
  secret: authSecret,
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: '/auth/signin',
    // Route auth errors back to our own page so expired links and delivery
    // failures land on the branded form (which offers a new link) instead of
    // Auth.js's default error page.
    error: '/auth/signin',
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Both sign-in methods we offer prove control of the SAME address:
      // Google only issues a verified email (asserted again in the signIn
      // callback in lib/auth.ts), and a magic link is by definition proof of
      // mailbox control. Linking on e-mail is therefore safe here — and it is
      // what makes invitations work at all, since an invited User row has no
      // provider Account until the person signs in for the first time.
      //
      // Before adding any provider that can return an UNVERIFIED address,
      // this must go, or that provider must be excluded from linking.
      allowDangerousEmailAccountLinking: true,
      // Sign-in only needs identity. Gmail access (read/send) is granted
      // per inbox via the dedicated /api/auth/gmail flow, whose tokens are
      // stored encrypted in EmailAccount. Requesting Gmail scopes here put
      // powerful tokens for EVERY agent into the Account table, which the
      // NextAuth adapter stores in plaintext.
      authorization: {
        params: {
          scope: 'openid email profile',
        },
      },
    }),
  ],
  callbacks: {
    // Runs in BOTH runtimes: it only copies claims the node-side jwt callback
    // already put on the token, which is what lets the middleware gate on
    // role/isSettingsAdmin without touching the database.
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) || 'agent';
        session.user.isSettingsAdmin = Boolean(token.isSettingsAdmin);
        session.user.tenantId = (token.tenantId as string | null) ?? null;
        session.user.provider = (token.provider as string | null) ?? null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
