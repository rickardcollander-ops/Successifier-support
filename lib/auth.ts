import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/client";
import { product } from "@/lib/products";
import { getTenant } from "@/lib/products/tenant";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: string;
    };
  }
}

const authSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  (process.env.NODE_ENV === "development" ? "local-dev-auth-secret-change-me" : undefined);

const ALLOWED_DOMAINS = product.allowedDomains;
const SUPERADMIN_EMAILS = ['rc@successifier.com'];

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
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  events: {
    async signIn(message) {
      console.log('[NextAuth] signIn event:', JSON.stringify(message, null, 2));
    },
    async createUser(message) {
      console.log('[NextAuth] createUser event:', JSON.stringify(message, null, 2));
      // Auto-assign the deployment's tenant for new users
      const tenant = await getTenant();
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
      if (ALLOWED_DOMAINS.includes(domain)) return true;
      return '/auth/signin?error=AccessDenied';
    },
    async jwt({ token, user }) {
      // On first sign-in, user object is available — persist id + role in token
      if (user) {
        token.id = user.id;
        try {
          const rows = await prisma.$queryRaw<Array<{ role: string }>>`SELECT role FROM "User" WHERE id = ${user.id} LIMIT 1`;
          token.role = rows[0]?.role || 'agent';
        } catch {
          token.role = 'agent';
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) || 'agent';
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
});
