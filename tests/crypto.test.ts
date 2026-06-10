import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  // 32 bytes = 64 hex chars, as required by lib/crypto
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
});

describe('lib/crypto', () => {
  it('round-trips plaintext through encrypt/decrypt', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto');
    const secret = 'sk_live_very_secret_value åäö';
    const encrypted = encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(decrypt(encrypted)).toBe(secret);
  });

  it('produces a fresh IV per call', async () => {
    const { encrypt } = await import('@/lib/crypto');
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('round-trips JSON credentials', async () => {
    const { encryptJSON, decryptJSON } = await import('@/lib/crypto');
    const creds = { apiKey: 're_123', fromEmail: 'support@example.com' };
    expect(decryptJSON(encryptJSON(creds))).toEqual(creds);
  });

  it('detects the encrypted format', async () => {
    const { encrypt, isEncrypted } = await import('@/lib/crypto');
    expect(isEncrypted(encrypt('x'))).toBe(true);
    expect(isEncrypted('plaintext-token')).toBe(false);
    expect(isEncrypted('a:b:c')).toBe(false);
  });

  it('decryptIfEncrypted passes plaintext through and decrypts ciphertext', async () => {
    const { encrypt, decryptIfEncrypted } = await import('@/lib/crypto');
    expect(decryptIfEncrypted('legacy-plaintext-token')).toBe('legacy-plaintext-token');
    expect(decryptIfEncrypted(encrypt('secret'))).toBe('secret');
  });

  it('rejects tampered ciphertext (GCM auth tag)', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto');
    const encrypted = encrypt('secret');
    const [iv, tag, data] = encrypted.split(':');
    const flipped = data.slice(0, -1) + (data.endsWith('0') ? '1' : '0');
    expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });
});
