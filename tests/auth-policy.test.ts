import { beforeEach, describe, expect, it, vi } from 'vitest';

// The policy is the only thing standing between "anyone with a Google
// account" and "the people this customer invited", so it is tested against a
// stubbed database rather than through NextAuth.
const findUnique = vi.fn();

vi.mock('@/lib/db/client', () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

const SUPERADMINS = ['rc@successifier.com'];

const baseConfig = {
  authProviders: ['google'] as ('google' | 'resend')[],
  allowedDomains: ['acme.se'],
  allowDomainAutoJoin: true,
};

async function decide(overrides: {
  email: string;
  provider?: string;
  tenantId?: string | null;
  config?: Partial<typeof baseConfig>;
}) {
  const { decideSignIn } = await import('@/lib/auth-policy');
  return decideSignIn({
    email: overrides.email,
    provider: overrides.provider ?? 'google',
    tenantId: overrides.tenantId === undefined ? 'tenant-a' : overrides.tenantId,
    config: { ...baseConfig, ...overrides.config },
    superadminEmails: SUPERADMINS,
  });
}

beforeEach(() => {
  findUnique.mockReset();
  findUnique.mockResolvedValue(null);
});

describe('lib/auth-policy decideSignIn', () => {
  it('admits a user provisioned for this tenant even off an allowlisted domain', async () => {
    findUnique.mockResolvedValue({ tenantId: 'tenant-a', status: 'invited' });
    const decision = await decide({ email: 'consultant@gmail.com' });
    expect(decision).toEqual({ allow: true, reason: 'provisioned' });
  });

  it('refuses an uninvited address even on an allowlisted domain when auto-join is off', async () => {
    const decision = await decide({
      email: 'random@acme.se',
      config: { allowDomainAutoJoin: false },
    });
    expect(decision).toEqual({ allow: false, reason: 'not-invited' });
  });

  it('admits an allowlisted domain while auto-join is on', async () => {
    const decision = await decide({ email: 'new@acme.se' });
    expect(decision).toEqual({ allow: true, reason: 'domain-auto-join' });
  });

  it('refuses a disabled account despite a matching domain', async () => {
    findUnique.mockResolvedValue({ tenantId: 'tenant-a', status: 'disabled' });
    const decision = await decide({ email: 'former@acme.se' });
    expect(decision).toEqual({ allow: false, reason: 'disabled-account' });
  });

  it("refuses another tenant's user on this subdomain", async () => {
    findUnique.mockResolvedValue({ tenantId: 'tenant-b', status: 'active' });
    const decision = await decide({ email: 'agent@other.se' });
    expect(decision).toEqual({ allow: false, reason: 'not-invited' });
  });

  it('refuses a provider the tenant has not enabled', async () => {
    const decision = await decide({ email: 'anyone@acme.se', provider: 'resend' });
    expect(decision).toEqual({ allow: false, reason: 'provider-disabled' });
  });

  it('admits magic link once the tenant enables it', async () => {
    findUnique.mockResolvedValue({ tenantId: 'tenant-a', status: 'active' });
    const decision = await decide({
      email: 'agent@acme.se',
      provider: 'resend',
      config: { authProviders: ['resend'] },
    });
    expect(decision).toEqual({ allow: true, reason: 'provisioned' });
  });

  it('lets a superadmin in on any tenant, even via a provider the tenant disabled', async () => {
    // Break-glass: a tenant whose configured method cannot deliver must not
    // lock out the only people able to repair it.
    expect(await decide({ email: 'RC@successifier.com' })).toEqual({
      allow: true,
      reason: 'superadmin',
    });
    expect(await decide({ email: 'rc@successifier.com', provider: 'resend' })).toEqual({
      allow: true,
      reason: 'superadmin',
    });
  });

  it('fails closed on an unresolved tenant: no domain auto-join', async () => {
    const decision = await decide({ email: 'new@acme.se', tenantId: null });
    expect(decision).toEqual({ allow: false, reason: 'not-invited' });
  });

  it('normalises the address before matching', async () => {
    findUnique.mockResolvedValue(null);
    await decide({ email: '  Agent@ACME.se ' });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'agent@acme.se' } }),
    );
  });
});

describe('lib/auth-policy provider helpers', () => {
  it('falls back to google when a tenant has no providers configured', async () => {
    const { enabledAuthProviders } = await import('@/lib/auth-policy');
    expect(enabledAuthProviders({ authProviders: [] })).toEqual(['google']);
    expect(enabledAuthProviders({ authProviders: undefined as never })).toEqual(['google']);
  });

  it('maps refusals to sign-in page errors without leaking which address exists', async () => {
    const { signInErrorFor } = await import('@/lib/auth-policy');
    expect(signInErrorFor({ allow: false, reason: 'disabled-account' })).toBe(
      '/auth/signin?error=AccessDenied',
    );
    expect(signInErrorFor({ allow: false, reason: 'not-invited' })).toBe(
      '/auth/signin?error=AccessDenied',
    );
    expect(signInErrorFor({ allow: false, reason: 'provider-disabled' })).toBe(
      '/auth/signin?error=ProviderDisabled',
    );
  });
});
