// Clerk (clerk.com) integration. Looks up the customer's user account in
// Clerk by email via the Backend API and surfaces everything a support agent
// typically needs for account/login questions: identity, contact details and
// their verification, login methods (password + social), MFA, account status
// (banned/locked), plan/metadata and organization memberships.
//
// Auth: a Clerk Secret Key (sk_live_… / sk_test_…) as a Bearer token.
// Docs: https://clerk.com/docs/reference/backend-api (GET /v1/users).

const CLERK_API_BASE = 'https://api.clerk.com/v1';

interface ClerkVerification {
  status?: string | null;
}
interface ClerkEmailAddress {
  id: string;
  email_address: string;
  verification?: ClerkVerification | null;
}
interface ClerkPhoneNumber {
  id: string;
  phone_number: string;
  verification?: ClerkVerification | null;
}
interface ClerkExternalAccount {
  provider?: string | null;
  verification?: ClerkVerification | null;
}
interface ClerkUser {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  created_at?: number | null;
  last_sign_in_at?: number | null;
  last_active_at?: number | null;
  banned?: boolean;
  locked?: boolean;
  lockout_expires_in_seconds?: number | null;
  password_enabled?: boolean;
  two_factor_enabled?: boolean;
  totp_enabled?: boolean;
  backup_code_enabled?: boolean;
  primary_email_address_id?: string | null;
  primary_phone_number_id?: string | null;
  email_addresses?: ClerkEmailAddress[];
  phone_numbers?: ClerkPhoneNumber[];
  external_accounts?: ClerkExternalAccount[];
  public_metadata?: Record<string, unknown> | null;
}
interface ClerkOrgMembership {
  role?: string | null;
  organization?: { name?: string | null; slug?: string | null } | null;
}

export interface ClerkContext {
  userId: string;
  name: string | null;
  username: string | null;
  primaryEmail: string | null;
  emailVerified: boolean;
  emails: Array<{ email: string; verified: boolean; primary: boolean }>;
  phone: string | null;
  phoneVerified: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
  lastActiveAt: number | null;
  passwordEnabled: boolean;
  twoFactorEnabled: boolean;
  socialAccounts: string[];
  banned: boolean;
  locked: boolean;
  lockoutExpiresInSeconds: number | null;
  plan: string | null;
  metadata: Record<string, unknown> | null;
  organizations: Array<{ name: string; role: string }>;
}

export class ClerkService {
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  private async request(path: string): Promise<any> {
    const res = await fetch(`${CLERK_API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Clerk API ${res.status}: ${await res.text().catch(() => '')}`);
    }
    return res.json();
  }

  async getUserByEmail(email: string): Promise<ClerkUser | null> {
    // GET /v1/users?email_address[]=<email> returns an array of matching users.
    const users = (await this.request(
      `/users?email_address[]=${encodeURIComponent(email)}&limit=1`,
    )) as ClerkUser[];
    return Array.isArray(users) && users.length > 0 ? users[0] : null;
  }

  // Best-effort: a missing scope or no-orgs setup shouldn't break the lookup.
  private async getOrganizations(userId: string): Promise<Array<{ name: string; role: string }>> {
    try {
      const res = await this.request(`/users/${userId}/organization_memberships?limit=20`);
      const data: ClerkOrgMembership[] = Array.isArray(res) ? res : res?.data || [];
      return data
        .map((m) => ({
          name: m.organization?.name || m.organization?.slug || 'Okänd organisation',
          role: (m.role || '').replace(/^org:/, ''),
        }))
        .filter((o) => o.name);
    } catch {
      return [];
    }
  }

  async getCustomerContext(email: string): Promise<ClerkContext | null> {
    try {
      const user = await this.getUserByEmail(email);
      if (!user) return null;

      const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null;

      const emails = (user.email_addresses || []).map((e) => ({
        email: e.email_address,
        verified: e.verification?.status === 'verified',
        primary: e.id === user.primary_email_address_id,
      }));
      const lower = email.trim().toLowerCase();
      const matched =
        emails.find((e) => e.email?.toLowerCase() === lower) ||
        emails.find((e) => e.primary) ||
        emails[0];
      const primaryEmail = (emails.find((e) => e.primary) || matched)?.email || null;
      const emailVerified = matched?.verified ?? false;

      const primaryPhone =
        user.phone_numbers?.find((p) => p.id === user.primary_phone_number_id) ||
        user.phone_numbers?.[0];

      const socialAccounts = Array.from(
        new Set(
          (user.external_accounts || [])
            .map((a) => (a.provider || '').replace(/^oauth_/, ''))
            .filter(Boolean),
        ),
      );

      const planValue = user.public_metadata?.plan;
      const plan = typeof planValue === 'string' ? planValue : null;

      const organizations = await this.getOrganizations(user.id);

      return {
        userId: user.id,
        name,
        username: user.username || null,
        primaryEmail,
        emailVerified,
        emails,
        phone: primaryPhone?.phone_number || null,
        phoneVerified: primaryPhone?.verification?.status === 'verified',
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        lastActiveAt: user.last_active_at ?? null,
        passwordEnabled: Boolean(user.password_enabled),
        twoFactorEnabled: Boolean(user.two_factor_enabled || user.totp_enabled || user.backup_code_enabled),
        socialAccounts,
        banned: Boolean(user.banned),
        locked: Boolean(user.locked),
        lockoutExpiresInSeconds: user.lockout_expires_in_seconds ?? null,
        plan,
        metadata:
          user.public_metadata && Object.keys(user.public_metadata).length > 0
            ? user.public_metadata
            : null,
        organizations,
      };
    } catch (error) {
      console.error('Error fetching Clerk context:', error);
      return null;
    }
  }
}
