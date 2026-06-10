import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'b'.repeat(64);
});

describe('lib/integrations/credentials', () => {
  it('masks every credential value but keeps the keys', async () => {
    const { maskCredentials } = await import('@/lib/integrations/credentials');
    const masked = maskCredentials({ apiKey: 'sk_live_123', fromEmail: 'a@b.se' });
    expect(Object.keys(masked)).toEqual(['apiKey', 'fromEmail']);
    expect(Object.values(masked)).not.toContain('sk_live_123');
    expect(Object.values(masked)).not.toContain('a@b.se');
  });

  it('merge keeps stored secrets when the submitted value is empty or masked', async () => {
    const { mergeCredentials } = await import('@/lib/integrations/credentials');
    const existing = { apiKey: 'sk_live_real', creditorPublicId: 'abc-123' };
    expect(mergeCredentials(existing, { apiKey: '', creditorPublicId: '' })).toEqual(existing);
    expect(mergeCredentials(existing, { apiKey: '••••••••', creditorPublicId: '****' })).toEqual(existing);
  });

  it('merge overwrites with genuinely new values', async () => {
    const { mergeCredentials } = await import('@/lib/integrations/credentials');
    const merged = mergeCredentials(
      { apiKey: 'old', creditorPublicId: 'abc' },
      { apiKey: '  new-key  ' }
    );
    expect(merged).toEqual({ apiKey: 'new-key', creditorPublicId: 'abc' });
  });

  it('reads encrypted, plain-object and stringified credentials', async () => {
    const { decryptCredentials } = await import('@/lib/integrations/credentials');
    const { encryptJSON } = await import('@/lib/crypto');
    const creds = { apiKey: 'k' };
    expect(decryptCredentials(encryptJSON(creds))).toEqual(creds);
    expect(decryptCredentials(creds)).toEqual(creds);
  });
});
