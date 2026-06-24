import crypto from 'crypto';

// Signed identity tokens for the LOGGED-IN customer chatbot (/api/me/chat).
//
// The chat widget runs in the customer's own browser, so we can NEVER trust an
// email the browser sends us directly — anyone could ask for someone else's
// data. Instead the customer's own site (e.g. doldadress), which already knows
// who is logged in, mints a short-lived token here on ITS server using a secret
// shared only between the two backends. We verify the signature and read the
// email out of the SIGNED payload — never out of the request body.
//
// Token format (compact, no external JWT dependency):
//   base64url(JSON payload) + "." + hex(HMAC-SHA256(payload, secret))
// where payload = { email, iat, exp } with iat/exp in seconds since epoch.

const SECRET_ENV = 'IDENTITY_TOKEN_SECRET';

// Tokens are minted right after login and used immediately by the widget, so a
// short window is plenty and limits the blast radius of a leaked token.
const DEFAULT_TTL_SECONDS = 15 * 60;

export interface IdentityClaims {
  email: string;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
}

function getSecret(): string {
  const secret = process.env[SECRET_ENV];
  if (!secret || secret.length < 32) {
    // Refuse to operate on a weak/missing secret rather than silently signing
    // forgeable tokens.
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

/**
 * Mint a signed identity token. Intended to run on the CUSTOMER's backend
 * (sharing IDENTITY_TOKEN_SECRET with this deployment) right after the customer
 * authenticates. Exported so it can also be used in tests and tooling.
 */
export function signIdentityToken(email: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error('email is required');

  const now = Math.floor(Date.now() / 1000);
  const payload: IdentityClaims = { email: normalized, iat: now, exp: now + ttlSeconds };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64, getSecret())}`;
}

export type VerifyResult =
  | { ok: true; claims: IdentityClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/**
 * Verify a token and return its claims. The email a caller acts on MUST come
 * from `claims.email` here, never from anything the client sent separately.
 */
export function verifyIdentityToken(token: string | null | undefined): VerifyResult {
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

  // Constant-time signature comparison. Bail before comparing if lengths
  // differ, since timingSafeEqual requires equal-length buffers.
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: IdentityClaims;
  try {
    const parsed = JSON.parse(fromBase64url(payloadB64).toString('utf8'));
    if (!parsed || typeof parsed.email !== 'string' || typeof parsed.exp !== 'number') {
      return { ok: false, reason: 'malformed' };
    }
    claims = { email: parsed.email, iat: Number(parsed.iat) || 0, exp: parsed.exp };
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, claims };
}
