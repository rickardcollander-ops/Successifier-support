import { describe, expect, it } from 'vitest';
import { rateLimit, clientIp } from '@/lib/rate-limit';

describe('lib/rate-limit', () => {
  it('allows up to the limit and then rejects within the window', () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(rateLimit('t1', opts).allowed).toBe(true);
    expect(rateLimit('t1', opts).allowed).toBe(true);
    expect(rateLimit('t1', opts).allowed).toBe(true);
    const rejected = rateLimit('t1', opts);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks keys independently', () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(rateLimit('a', opts).allowed).toBe(true);
    expect(rateLimit('b', opts).allowed).toBe(true);
    expect(rateLimit('a', opts).allowed).toBe(false);
  });

  it('extracts the first forwarded IP', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' });
    expect(clientIp(headers)).toBe('1.2.3.4');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
