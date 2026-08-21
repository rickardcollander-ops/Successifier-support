import crypto from 'crypto';

// Every outbound delivery is signed so the receiver can prove the request
// came from us and was not replayed. The scheme is deliberately the same
// shape as Stripe's, because that is what integrators already know how to
// verify and what the Developer Portal documents:
//
//   X-Successifier-Signature: t=1755777600,v1=<hex hmac>
//   signed payload           = "<t>.<raw request body>"
//   hmac                     = HMAC-SHA256(signed payload, endpoint secret)
//
// The timestamp is inside the signed payload, so an attacker can neither
// change it nor replay an old body under a fresh timestamp.

export const SIGNATURE_HEADER = 'X-Successifier-Signature';
export const EVENT_HEADER = 'X-Successifier-Event';
export const DELIVERY_HEADER = 'X-Successifier-Delivery';

/** Default window a receiver should accept a delivery within (seconds). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signedPayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

/** The hex HMAC alone. */
export function webhookSignature(body: string, secret: string, timestamp: number): string {
  return crypto.createHmac('sha256', secret).update(signedPayload(timestamp, body)).digest('hex');
}

/** The full header value we send: `t=<unix>,v1=<hex>`. */
export function webhookSignatureHeader(body: string, secret: string, timestamp: number): string {
  return `t=${timestamp},v1=${webhookSignature(body, secret, timestamp)}`;
}

function parseHeader(header: string): { t: number; v1: string } | null {
  const parts = Object.fromEntries(
    header
      .split(',')
      .map((part) => part.trim().split('='))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return null;
  return { t, v1: parts.v1 };
}

/**
 * Verify a delivery the way a receiver should. Exported because it is what
 * the docs tell customers to implement — keeping the reference
 * implementation in the codebase means the documented snippet is tested
 * against the real signer instead of drifting from it.
 */
export function verifyWebhookSignature(
  body: string,
  header: string | null | undefined,
  secret: string,
  { toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS, now = Date.now() }: {
    toleranceSeconds?: number;
    now?: number;
  } = {},
): boolean {
  if (!header) return false;
  const parsed = parseHeader(header);
  if (!parsed) return false;

  if (toleranceSeconds > 0) {
    const ageSeconds = Math.abs(Math.floor(now / 1000) - parsed.t);
    if (ageSeconds > toleranceSeconds) return false;
  }

  const expected = webhookSignature(body, secret, parsed.t);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parsed.v1, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** A fresh endpoint secret. Shown in plaintext exactly once. */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}
