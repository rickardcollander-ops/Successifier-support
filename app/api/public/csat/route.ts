import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { verifyCsatToken, CSAT_RATINGS, type CsatRating } from '@/lib/csat-token';

// One-click CSAT landing. Public by design — the links land in the
// customer's inbox (no session possible) — so it defends itself:
//   - the ticket id comes ONLY from the HMAC-signed token minted at send
//     time (lib/csat-token.ts); nothing client-supplied selects a ticket
//   - tenantId is taken from the ticket ROW, never from input
//   - per-IP rate limit
//   - ONE row per ticket (upsert on the unique ticketId): a second click
//     flips the rating instead of stacking votes, and repeated clicks on a
//     forwarded mail can't inflate the stats
// GET records the rating and shows a small thank-you page with an optional
// comment form; POST attaches the comment to the already-recorded rating.

const COMMENT_MAX = 2000;

const isRating = (v: string | null): v is CsatRating =>
  v != null && (CSAT_RATINGS as readonly string[]).includes(v);

// Minimal standalone HTML page (no app chrome — the visitor is a customer,
// not an agent). Language follows the product.
function page(body: string, status = 200): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="${product.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${product.displayName}</title></head>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f8fafc;margin:0;padding:40px 16px;">
<div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;text-align:center;">
${body}
</div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

const STRINGS = {
  sv: {
    thanks: 'Tack för din feedback!',
    recorded: 'Ditt svar har sparats.',
    commentLabel: 'Vill du berätta mer? (frivilligt)',
    commentSend: 'Skicka kommentar',
    commentThanks: 'Tack, din kommentar har sparats.',
    invalid: 'Länken är ogiltig eller har gått ut.',
  },
  en: {
    thanks: 'Thank you for your feedback!',
    recorded: 'Your answer has been recorded.',
    commentLabel: 'Want to tell us more? (optional)',
    commentSend: 'Send comment',
    commentThanks: 'Thank you, your comment has been saved.',
    invalid: 'The link is invalid or has expired.',
  },
}[product.language];

export async function GET(request: NextRequest) {
  const limit = rateLimit(`csat:${clientIp(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return new NextResponse('Too many requests', {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    });
  }

  try {
    const token = request.nextUrl.searchParams.get('token');
    const rating = request.nextUrl.searchParams.get('rating');
    const verified = verifyCsatToken(token);
    if (!verified.ok || !isRating(rating)) {
      return page(`<p style="color:#334155;">${STRINGS.invalid}</p>`, 400);
    }

    // Tenant scoping: the ticket row is the source of truth for tenantId.
    const ticket = await prisma.ticket.findUnique({
      where: { id: verified.claims.ticketId },
      select: { id: true, tenantId: true },
    });
    if (!ticket) {
      return page(`<p style="color:#334155;">${STRINGS.invalid}</p>`, 400);
    }

    await prisma.csatResponse.upsert({
      where: { ticketId: ticket.id },
      update: { rating },
      create: { tenantId: ticket.tenantId, ticketId: ticket.id, rating },
    });

    const emoji = rating === 'positive' ? '👍' : '👎';
    return page(`
<p style="font-size:40px;margin:0 0 8px;">${emoji}</p>
<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a;">${STRINGS.thanks}</h1>
<p style="color:#64748b;margin:0 0 20px;">${STRINGS.recorded}</p>
<form method="POST" action="/api/public/csat">
  <input type="hidden" name="token" value="${token ?? ''}">
  <label style="display:block;text-align:left;font-size:13px;color:#64748b;margin-bottom:6px;">${STRINGS.commentLabel}</label>
  <textarea name="comment" maxlength="${COMMENT_MAX}" rows="4" style="width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit;"></textarea>
  <button type="submit" style="margin-top:12px;background:#7C5CFF;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">${STRINGS.commentSend}</button>
</form>`);
  } catch (error) {
    console.error('[csat] failed to record rating:', error);
    return page(`<p style="color:#334155;">${STRINGS.invalid}</p>`, 500);
  }
}

// Attach an optional free-text comment to an already-recorded rating. The
// token gates this exactly like the rating click; without an existing
// rating row there is nothing to attach to (400).
export async function POST(request: NextRequest) {
  const limit = rateLimit(`csat:${clientIp(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return new NextResponse('Too many requests', {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    });
  }

  try {
    const form = await request.formData();
    const token = form.get('token');
    const comment = String(form.get('comment') ?? '').trim().slice(0, COMMENT_MAX);
    const verified = verifyCsatToken(typeof token === 'string' ? token : null);
    if (!verified.ok) {
      return page(`<p style="color:#334155;">${STRINGS.invalid}</p>`, 400);
    }

    if (comment) {
      const existing = await prisma.csatResponse.findUnique({
        where: { ticketId: verified.claims.ticketId },
        select: { id: true },
      });
      if (!existing) {
        return page(`<p style="color:#334155;">${STRINGS.invalid}</p>`, 400);
      }
      await prisma.csatResponse.update({
        where: { ticketId: verified.claims.ticketId },
        data: { comment },
      });
    }

    return page(`
<p style="font-size:40px;margin:0 0 8px;">🙏</p>
<h1 style="font-size:20px;margin:0 0 8px;color:#0f172a;">${STRINGS.commentThanks}</h1>`);
  } catch (error) {
    console.error('[csat] failed to save comment:', error);
    return page(`<p style="color:#334155;">${STRINGS.invalid}</p>`, 500);
  }
}
