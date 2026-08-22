import NextAuth from "next-auth";
import ResendProvider from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import { getTenant, resolveTenantForRequest, resolveTenantFromHeaders } from "@/lib/products/tenant";
import { isSettingsAdmin } from "@/lib/access";
import { decideSignIn, normalizeEmail, signInErrorFor } from "@/lib/auth-policy";
import { sendMagicLinkEmail } from "@/lib/services/auth-email";
import { rateLimit } from "@/lib/rate-limit";
import { DEFAULT_TENANT_CONFIG } from "@/lib/products/defaults";
import { authConfig } from "@/lib/auth.config";

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
      // Which provider proved this identity ('google' | 'resend'). Shown in
      // the user admin so an admin can see how each account signs in.
      provider?: string | null;
    };
  }
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

// How long a magic link stays valid. Short: the link is used within a minute
// of asking for it, and a short window limits the damage of a forwarded or
// intercepted mail.
const MAGIC_LINK_TTL_SECONDS = 10 * 60;

// A JWT session carries role/tenant/status, so those values are only as fresh
// as the token. The jwt callback re-reads them from the database whenever the
// token is older than this — the window within which disabling an account,
// changing a role or deleting a user actually takes effect.
const SESSION_REFRESH_SECONDS = 5 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Everything edge-safe (secret, session lifetime, sign-in page, Google) is
  // shared with the middleware instance via lib/auth.config.ts.
  ...authConfig,
  debug: process.env.NODE_ENV === 'development',
  adapter: PrismaAdapter(prisma),
  providers: [
    ...authConfig.providers,
    // Magic link, for customers on neither Google nor Microsoft. Always
    // registered: the primary sending route is the TENANT's own Resend
    // integration, which lives in the database, so there is no env var that
    // could tell us up front whether a given tenant can send. Who may USE it
    // is decided per tenant by their authProviders config, in the signIn
    // callback below.
    //
    // apiKey/from are placeholders — sendVerificationRequest below replaces
    // the provider's own sending entirely (lib/services/auth-email.ts), so
    // the mail carries the tenant's brand and goes out over their integration.
    ResendProvider({
      apiKey: 'unused-see-sendVerificationRequest',
      from: process.env.AUTH_EMAIL_FROM || 'no-reply@successifier.com',
      maxAge: MAGIC_LINK_TTL_SECONDS,
      async sendVerificationRequest({ identifier, url }) {
        // Cap how often one address can be mailed. Without this, anyone who
        // knows an agent's address can flood their inbox by resubmitting the
        // sign-in form. Best effort only — the limiter is per serverless
        // instance (see lib/rate-limit.ts).
        const { allowed } = rateLimit(`magic-link:${identifier}`, {
          limit: 3,
          windowMs: 10 * 60 * 1000,
        });
        if (!allowed) {
          // Return quietly: the sign-in page shows the same confirmation
          // either way, so a throttled address is indistinguishable from a
          // delivered one.
          console.warn('[NextAuth] magic link throttled for', identifier);
          return;
        }

        const ctx = await resolveTenantFromHeaders();
        // A throw here surfaces as an EmailSignin error on the sign-in page.
        // That is deliberate: a tenant with magic link enabled but no way to
        // send must fail loudly, not silently show "check your inbox".
        await sendMagicLinkEmail({
          to: identifier,
          url,
          tenantId: ctx?.tenant.id ?? null,
          config: ctx?.config ?? DEFAULT_TENANT_CONFIG,
          expiresMinutes: Math.round(MAGIC_LINK_TTL_SECONDS / 60),
        });
      },
    }),
  ],
  events: {
    async signIn(message) {
      console.log('[NextAuth] signIn:', message.user?.email);
      // First successful sign-in flips an invited account to active and
      // stamps the login, so the user admin can show who has actually
      // accepted their invitation and who is still pending.
      const address = normalizeEmail(message.user?.email);
      if (!address) return;
      try {
        await prisma.user.updateMany({
          where: { email: address, status: { not: 'disabled' } },
          data: { status: 'active', lastLoginAt: new Date() },
        });
      } catch (error) {
        console.error('[NextAuth] failed to stamp login:', error);
      }
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
    async signIn({ user, account, profile, email }) {
      const address = normalizeEmail(user.email);
      if (!address) return '/auth/signin?error=AccessDenied';

      // Google must assert the address is verified. Without this the e-mail
      // account linking enabled above would let an unverified Google profile
      // claim an invited address.
      if (account?.provider === 'google' && profile && profile.email_verified === false) {
        return '/auth/signin?error=AccessDenied';
      }

      const ctx = await resolveTenantFromHeaders();
      const decision = await decideSignIn({
        email: address,
        provider: account?.provider || 'google',
        tenantId: ctx?.tenant.id ?? null,
        config: ctx?.config ?? DEFAULT_TENANT_CONFIG,
        superadminEmails: SUPERADMIN_EMAILS,
      });

      if (!decision.allow) {
        // On the magic-link request leg (`email.verificationRequest`) this
        // return value suppresses the mail entirely, so an address that may
        // not sign in never receives a link. The sign-in page shows the same
        // "check your inbox" message either way — a different message here
        // would turn the form into an address oracle.
        console.warn(
          '[NextAuth] sign-in refused:',
          decision.reason,
          'provider=', account?.provider,
          'verificationRequest=', Boolean(email?.verificationRequest),
        );
        return signInErrorFor(decision);
      }

      return true;
    },
    async jwt({ token, user, account }) {
      const onEdge = process.env.NEXT_RUNTIME === 'edge';
      const nowSeconds = Math.floor(Date.now() / 1000);

      // On first sign-in, user object is available — persist id + role in token
      if (user) {
        token.id = user.id;
        if (account?.provider) token.provider = account.provider;
        try {
          const rows = await prisma.$queryRaw<Array<{ role: string; tenantId: string | null }>>`SELECT role, "tenantId" FROM "User" WHERE id = ${user.id} LIMIT 1`;
          token.role = rows[0]?.role || 'agent';
          token.tenantId = rows[0]?.tenantId || null;
        } catch {
          token.role = 'agent';
        }
        token.checkedAt = nowSeconds;
      } else if (!onEdge && token.id && nowSeconds - Number(token.checkedAt || 0) >= SESSION_REFRESH_SECONDS) {
        // Periodic re-read: a JWT session would otherwise carry the role,
        // tenant and existence the user had when they signed in. This is what
        // makes "remove user" and "disable account" in the user admin bite
        // within minutes instead of at token expiry.
        //
        // Skipped on the edge runtime (middleware) because Prisma can't run
        // there — the check happens on the next server-side call instead, and
        // every API route goes through lib/api-auth.ts regardless.
        try {
          const rows = await prisma.$queryRaw<
            Array<{ role: string; tenantId: string | null; status: string }>
          >`SELECT role, "tenantId", status FROM "User" WHERE id = ${token.id as string} LIMIT 1`;
          const row = rows[0];
          // Deleted or disabled — invalidate the session outright. Returning
          // null makes auth() resolve to no session, so the middleware bounces
          // the next request to the sign-in page.
          if (!row || row.status === 'disabled') return null;
          token.role = row.role || 'agent';
          token.tenantId = row.tenantId || null;
          token.checkedAt = nowSeconds;
        } catch (error) {
          // A transient database error must not sign everyone out; keep the
          // existing claims and re-check on the next refresh.
          console.error('[NextAuth] session refresh failed, keeping token:', error);
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
    // session() is inherited from authConfig — the middleware needs the very
    // same claim mapping, so it lives in the shared, edge-safe half.
    session: authConfig.callbacks.session,
  },
});
