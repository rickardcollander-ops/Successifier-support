import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.IDENTITY_TOKEN_SECRET = 's'.repeat(48);
});

describe('lib/identity-token', () => {
  it('round-trips a signed token and lowercases/trims the email', async () => {
    const { signIdentityToken, verifyIdentityToken } = await import('@/lib/identity-token');
    const token = signIdentityToken('  Customer@Example.COM ');
    const result = verifyIdentityToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.email).toBe('customer@example.com');
  });

  it('rejects a tampered payload (signature no longer matches)', async () => {
    const { signIdentityToken, verifyIdentityToken } = await import('@/lib/identity-token');
    const token = signIdentityToken('a@b.com');
    const [, sig] = token.split('.');
    // Swap the payload for one claiming a different email, keep the old sig.
    const forgedPayload = Buffer.from(JSON.stringify({ email: 'victim@b.com', iat: 1, exp: 9999999999 }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const result = verifyIdentityToken(`${forgedPayload}.${sig}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_signature');
  });

  it('rejects an expired token', async () => {
    const { signIdentityToken, verifyIdentityToken } = await import('@/lib/identity-token');
    const token = signIdentityToken('a@b.com', -1); // already expired
    const result = verifyIdentityToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects malformed input', async () => {
    const { verifyIdentityToken } = await import('@/lib/identity-token');
    expect(verifyIdentityToken(null).ok).toBe(false);
    expect(verifyIdentityToken('').ok).toBe(false);
    expect(verifyIdentityToken('no-dot').ok).toBe(false);
    expect(verifyIdentityToken('only.').ok).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const { verifyIdentityToken } = await import('@/lib/identity-token');
    const crypto = await import('crypto');
    const payload = Buffer.from(JSON.stringify({ email: 'a@b.com', iat: 1, exp: 9999999999 }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const sig = crypto.createHmac('sha256', 'a-different-secret-of-sufficient-length!!').update(payload).digest('hex');
    const result = verifyIdentityToken(`${payload}.${sig}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_signature');
  });
});
