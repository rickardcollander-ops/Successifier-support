import crypto from 'crypto';
import { product } from '@/lib/products';

// Signed tokens for the one-click CSAT links in outgoing replies.
//
// The rating links land in the CUSTOMER's inbox and hit a public route
// (/api/public/csat), so the ticket id must be unforgeable — otherwise
// anyone could stuff ratings for arbitrary tickets. Same compact
// HMAC-signed format as lib/identity-token.ts:
//   base64url(JSON payload) + "." + hex(HMAC-SHA256(payload, secret))
// where payload = { ticketId, exp }. The rating itself travels as a plain
// query parameter — it's the customer's own choice, only the ticket
// identity needs protecting.

const SECRET_ENV = 'CSAT_TOKEN_SECRET';

// Customers rate whenever they get around to reading the reply — days, not
// minutes — so the window is long. The single-row-per-ticket upsert (latest
// click wins) keeps a long-lived link harmless.
const DEFAULT_TTL_SECONDS = 30 * 24 * 3600;

export const CSAT_RATINGS = ['positive', 'negative'] as const;
export type CsatRating = (typeof CSAT_RATINGS)[number];

export interface CsatClaims {
  ticketId: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

function getSecret(): string {
  const secret = process.env[SECRET_ENV];
  if (!secret || secret.length < 32) {
    // Refuse to operate on a weak/missing secret rather than silently
    // signing forgeable tokens.
    throw new Error(`${SECRET_ENV} must be set to at least 32 characters`);
  }
  return secret;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
}

export function signCsatToken(ticketId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  if (!ticketId) throw new Error('ticketId is required');
  const payload: CsatClaims = {
    ticketId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, getSecret())}`;
}

export type CsatVerifyResult =
  | { ok: true; claims: CsatClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/**
 * Verify a token and return its claims. The ticket a caller acts on MUST
 * come from `claims.ticketId` here, never from a separate parameter.
 */
export function verifyCsatToken(token: string | null | undefined): CsatVerifyResult {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'malformed' };
  }
  const [payloadB64, signature] = token.split('.', 2);
  if (!payloadB64 || !signature) return { ok: false, reason: 'malformed' };

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }

  // Constant-time signature comparison; equal lengths required first.
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: CsatClaims;
  try {
    const parsed = JSON.parse(fromBase64url(payloadB64).toString('utf8'));
    if (!parsed || typeof parsed.ticketId !== 'string' || typeof parsed.exp !== 'number') {
      return { ok: false, reason: 'malformed' };
    }
    claims = { ticketId: parsed.ticketId, exp: parsed.exp };
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, claims };
}

/**
 * The CSAT footer appended to the HTML part of outgoing replies, or null
 * when CSAT can't be offered (feature off, missing secret/base URL — a
 * misconfiguration must never block sending the reply itself).
 * HTML-only by design: the plain-text alternative stays clean of links.
 */
export function buildCsatFooterHtml(ticketId: string): string | null {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) return null;
  let token: string;
  try {
    token = signCsatToken(ticketId);
  } catch {
    return null;
  }
  const link = (rating: CsatRating) =>
    `${baseUrl}/api/public/csat?token=${encodeURIComponent(token)}&rating=${rating}`;
  const sv = product.language === 'sv';
  const question = sv ? 'Hur var hjälpen?' : 'How was our help?';
  const good = sv ? 'Bra' : 'Good';
  const bad = sv ? 'Mindre bra' : 'Not so good';
  return (
    `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;">` +
    `${question} ` +
    `<a href="${link('positive')}" style="color:#059669;text-decoration:none;">👍 ${good}</a>` +
    `&nbsp;·&nbsp;` +
    `<a href="${link('negative')}" style="color:#dc2626;text-decoration:none;">👎 ${bad}</a>` +
    `</div>`
  );
}
