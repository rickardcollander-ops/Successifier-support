// Clerk (clerk.com) integration. Looks up the customer's user account in
// Clerk by email via the Backend API so support sees whether the person has
// an account, when they signed up, last sign-in, verification and plan.
//
// Auth: a Clerk Secret Key (sk_live_… / sk_test_…) as a Bearer token.
// Docs: https://clerk.com/docs/reference/backend-api (GET /v1/users).

const CLERK_API_BASE = 'https://api.clerk.com/v1';

interface ClerkEmailAddress {
  id: string;
  email_address: string;
  verification?: { status?: string } | null;
}

interface ClerkUser {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  created_at?: number | null;
  last_sign_in_at?: number | null;
  banned?: boolean;
  locked?: boolean;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmailAddress[];
  public_metadata?: Record<string, unknown> | null;
}

export interface ClerkContext {
  userId: string;
  name: string | null;
  createdAt: number | null;
  lastSignInAt: number | null;
  emailVerified: boolean;
  banned: boolean;
  locked: boolean;
  plan: string | null;
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

  async getCustomerContext(email: string): Promise<ClerkContext | null> {
    try {
      const user = await this.getUserByEmail(email);
      if (!user) return null;

      const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null;

      // Verified if the matching email address is verified (fall back to the
      // primary address when we can't match the exact one).
      const lower = email.trim().toLowerCase();
      const match =
        user.email_addresses?.find((e) => e.email_address?.toLowerCase() === lower) ||
        user.email_addresses?.find((e) => e.id === user.primary_email_address_id) ||
        user.email_addresses?.[0];
      const emailVerified = match?.verification?.status === 'verified';

      const planValue = user.public_metadata?.plan;
      const plan = typeof planValue === 'string' ? planValue : null;

      return {
        userId: user.id,
        name,
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        emailVerified,
        banned: Boolean(user.banned),
        locked: Boolean(user.locked),
        plan,
      };
    } catch (error) {
      console.error('Error fetching Clerk context:', error);
      return null;
    }
  }
}
