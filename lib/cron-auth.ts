import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

// Auth guard for the /api/cron/* routes. Vercel Cron invokes them with
// `Authorization: Bearer <CRON_SECRET>`; the middleware deliberately lets
// any /api request with an Authorization header through to the route (it
// can't validate secrets in the edge runtime), so the route must verify the
// secret itself. Do NOT use requireApiAuth here — it would reject the cron
// bearer token (it's not a session or API key).

export function requireCronSecret(
  request: NextRequest
): { ok: true } | { ok: false; response: NextResponse } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured = cron endpoints disabled, never open.
    return {
      ok: false,
      response: NextResponse.json({ error: 'Cron not configured' }, { status: 503 }),
    };
  }
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  // timingSafeEqual demands equal lengths; a length mismatch is already a
  // failed comparison, but still goes through one dummy compare so the
  // early-exit doesn't leak length information.
  const match = a.length === b.length ? timingSafeEqual(a, b) : (timingSafeEqual(b, b), false);
  if (!match) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true };
}
