import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  signCsatToken,
  verifyCsatToken,
  buildCsatFooterHtml,
} from '@/lib/csat-token';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

beforeEach(() => {
  process.env.CSAT_TOKEN_SECRET = SECRET;
  delete process.env.APP_BASE_URL;
});

afterEach(() => {
  delete process.env.CSAT_TOKEN_SECRET;
  delete process.env.APP_BASE_URL;
});

describe('csat token', () => {
  it('round-trips: a signed token verifies to its ticket id', () => {
    const token = signCsatToken('ticket-abc');
    const result = verifyCsatToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.ticketId).toBe('ticket-abc');
  });

  it('rejects expired tokens', () => {
    const token = signCsatToken('ticket-abc', -10);
    expect(verifyCsatToken(token)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('rejects tampered payloads and garbage', () => {
    const token = signCsatToken('ticket-abc');
    const [payload, sig] = token.split('.');
    // Flip the payload but keep the old signature.
    const forgedPayload = Buffer.from(JSON.stringify({ ticketId: 'other', exp: 9999999999 }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifyCsatToken(`${forgedPayload}.${sig}`)).toMatchObject({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyCsatToken(`${payload}.deadbeef`)).toMatchObject({ ok: false });
    expect(verifyCsatToken('not-a-token')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(verifyCsatToken(null)).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('refuses to sign with a weak/missing secret', () => {
    process.env.CSAT_TOKEN_SECRET = 'short';
    expect(() => signCsatToken('ticket-abc')).toThrow();
  });
});

describe('buildCsatFooterHtml', () => {
  it('returns null without APP_BASE_URL or a usable secret — never blocks a send', () => {
    expect(buildCsatFooterHtml('ticket-abc')).toBeNull();

    process.env.APP_BASE_URL = 'https://app.example.com';
    delete process.env.CSAT_TOKEN_SECRET;
    expect(buildCsatFooterHtml('ticket-abc')).toBeNull();
  });

  it('renders both rating links against the public csat route', () => {
    process.env.APP_BASE_URL = 'https://app.example.com';
    const html = buildCsatFooterHtml('ticket-abc');
    expect(html).toBeTruthy();
    expect(html).toContain('https://app.example.com/api/public/csat?token=');
    expect(html).toContain('rating=positive');
    expect(html).toContain('rating=negative');
    // The embedded token must verify back to the same ticket.
    const token = decodeURIComponent(html!.match(/token=([^&]+)&/)![1]);
    const result = verifyCsatToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.ticketId).toBe('ticket-abc');
  });
});
