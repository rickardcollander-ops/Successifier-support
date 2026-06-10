import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey, maskApiKey } from '@/lib/api-keys';

describe('lib/api-keys', () => {
  it('generates keys with the product prefix and high entropy', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^[a-z]+_[A-Za-z0-9_-]{32}$/);
  });

  it('never generates the same key twice', () => {
    const keys = new Set(Array.from({ length: 1000 }, () => generateApiKey()));
    expect(keys.size).toBe(1000);
  });

  it('hashes deterministically with SHA-256', () => {
    const key = 'dold_test_key';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).not.toBe(hashApiKey('dold_other_key'));
  });

  it('masks all but the first 8 and last 4 characters', () => {
    const key = generateApiKey();
    const masked = maskApiKey(key);
    expect(masked).toBe(`${key.slice(0, 8)}…${key.slice(-4)}`);
    expect(masked.length).toBeLessThan(key.length);
  });
});
