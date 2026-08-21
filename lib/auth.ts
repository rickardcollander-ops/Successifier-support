import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import { getTenant, resolveTenantForRequest, resolveTenantFromHeaders } from "@/lib/products/tenant";
import { isSettingsAdmin } from "@/lib/access";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: string;
      // Whether this user may access the Settings/admin area on this
      // deployment (superadmin, or the product's admin allowlist e.g. Ida).
      isSettingsAdmin: boolean;
      // The tenant the user belongs to. Drives per-request tenant
      // resolution (lib/api-auth.ts) so one deployment can serve many
      // tenants.
      tenantId?: string | null;
    };
  }
}

const authSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  (process.env.NODE_ENV === "development" ? "local-dev-auth-secret-change-me" : undefined);

// Without a secret Auth.js fails its config assertion before it ever routes a
// request, so EVERY /api/auth/* endpoint answers 500 "There is a problem with
// the server configuration" — /api/auth/csrf included, which means the Google
// button on the sign-in page cannot even start the OAuth flow. That message
// names no cause, so name it here: this line is what tells you which env var
// is missing on a deployment that suddenly cannot log anyone in.
if (!authSecret) {
  console.error(
    '[NextAuth] FATAL: neither AUTH_SECRET nor NEXTAUTH_SECRET is set on this ' +
      'deployment. All /api/auth/* routes will return 500 and nobody can sign ' +
      'in. Generate one with `openssl rand -base64 32`, add it to the ' +
      'environment (both names, same value) and redeploy.',
  );
}

// Same story for the Google credentials: the non-null assertions below hide a
// missing value until Google rejects the authorize request with a useless
// error, so say it up front.
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error(
    '[NextAuth] FATAL: GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET is missing ' +
      '— Google sign-in cannot work on this deployment.',
  );
}

// Emails that may sign in regardless of allowedDomains AND are granted admin
// (superadmin) access on every deployment — see the jwt callback, which forces
// role = 'superadmin' for these regardless of the per-product User.role.
// Overridable per deployment via SUPERADMIN_EMAILS (comma-separated).
const SUPERADMIN_EMAILS = (
  process.env.SUPERADMIN_EMAILS || 'rc@successifier.com,mc@successifier.com'
)
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  trustHost: true,
  debug: process.env.NODE_ENV === 'development',
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
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
  events: {
    async signIn(message) {
      console.log('[NextAuth] signIn:', message.user?.email);
    },
    async createUser(message) {
      console.log('[NextAuth] createUser:', message.user?.email);
      // Auto-assign the request's tenant (host subdomain or env pin) to
      // new users.
      const ctx = await resolveTenantFromHeaders();
      const tenant = ctx?.tenant ?? (await getTenant());
      if (tenant && message.user?.id) {
        await prisma.user.update({
          where: { id: message.user.id },
          data: { tenantId: tenant.id },
        });
        console.log('[NextAuth] Assigned tenant', tenant.id, 'to user', message.user.id);
      }
    },
  },
  logger: {
    error(code, ...message) {
      console.error('[NextAuth ERROR]', code, ...message);
    },
    warn(code, ...message) {
      console.warn('[NextAuth WARN]', code, ...message);
    },
    debug(code, ...message) {
      console.log('[NextAuth DEBUG]', code, ...message);
    },
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase() || '';
      const domain = email.split('@')[1] || '';
      if (SUPERADMIN_EMAILS.includes(email)) return true;
      // The sign-in domain allowlist is per tenant, resolved from the
      // request host (or the deployment's env pin) and stored in the DB —
      // editable at runtime without a redeploy.
      const ctx = await resolveTenantFromHeaders();
      const allowedDomains = ctx?.config.allowedDomains ?? [];
      if (allowedDomains.includes(domain)) return true;
      // Users already provisioned for a tenant (invited via the user admin)
      // may sign in even when their domain isn't allowlisted.
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing?.tenantId) return true;
      return '/auth/signin?error=AccessDenied';
    },
    async jwt({ token, user }) {
      // On first sign-in, user object is available — persist id + role in token
      if (user) {
        token.id = user.id;
        try {
          const rows = await prisma.$queryRaw<Array<{ role: string; tenantId: string | null }>>`SELECT role, "tenantId" FROM "User" WHERE id = ${user.id} LIMIT 1`;
          token.role = rows[0]?.role || 'agent';
          token.tenantId = rows[0]?.tenantId || null;
        } catch {
          token.role = 'agent';
        }
      }
      // Make the user's tenant the active request context so the settings-
      // admin check below reads THAT tenant's admin allowlist. Skipped on
      // the edge runtime (middleware runs auth() there and Prisma cannot
      // execute on edge) — the token already carries the computed flags.
      if (process.env.NEXT_RUNTIME !== 'edge') {
        if (token.tenantId) {
          await resolveTenantForRequest({ tenantId: token.tenantId as string });
        } else {
          await resolveTenantFromHeaders();
        }
      }
      // Allowlisted superadmins get admin access on every deployment,
      // regardless of the per-product User.role in that product's database.
      const email = (user?.email || (token.email as string) || '').toLowerCase();
      if (email && SUPERADMIN_EMAILS.includes(email)) {
        token.role = 'superadmin';
      }
      // Settings/admin access: superadmins plus the product's admin allowlist
      // (e.g. Ida). Stored on the token so the middleware and session can gate
      // the Settings area without another DB lookup.
      token.isSettingsAdmin = isSettingsAdmin(email, token.role as string);
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) || 'agent';
        session.user.isSettingsAdmin = Boolean(token.isSettingsAdmin);
        session.user.tenantId = (token.tenantId as string | null) ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    // Keep failures on our own branded page. The built-in /api/auth/error page
    // renders an unbranded "Server error" with no hint of what to do; the
    // sign-in page turns the same ?error= code into a Swedish explanation.
    error: '/auth/signin',
  },
});
