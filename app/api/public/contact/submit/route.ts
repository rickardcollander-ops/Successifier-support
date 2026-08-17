import { NextRequest, NextResponse, after } from 'next/server';
import { prisma } from '@/lib/db/client';
import { classifyTicket } from '@/lib/services/ticket-classifier';
import { getTenantId } from '@/lib/products/tenant';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { corsHeaders, logKbEvent } from '@/lib/services/public-kb';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { upsertTicket } from '@/lib/services/deduplicator';
import {
  CONTACT_MESSAGE_MAX,
  CONTACT_NAME_MAX,
  buildContactTicketMessage,
  deriveSubject,
  isValidContactEmail,
} from '@/lib/services/contact-form';

// Step 2 of the AI contact form: the instant answer did NOT solve the
// customer's problem (or the AI is disabled), so the question becomes a real
// ticket. The AI answer the customer already saw is embedded in the ticket
// body so the agent knows what has been tried, and never repeats it.
//
// This endpoint is public (no API key — it serves the help center's own
// visitors), so it defends itself: strict per-IP rate limit, field length
// caps, email validation and a honeypot field that bots fill in but humans
// never see. Honeypot hits return a fake success so the bot learns nothing.

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function POST(request: NextRequest) {
  const cors = corsHeaders(request.headers.get('origin'));

  // Tighter than the AI endpoints: a human sends at most a handful of
  // tickets, ever. 5 per 10 minutes per IP stops scripted spam cold.
  const { allowed, retryAfterSeconds } = rateLimit(`contact:submit:${clientIp(request.headers)}`, {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...cors, 'Retry-After': String(retryAfterSeconds) } }
    );
  }

  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: 'Not available' }, { status: 404, headers: cors });
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, CONTACT_NAME_MAX) : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const aiAnswer = typeof body?.aiAnswer === 'string' ? body.aiAnswer.trim().slice(0, 8000) : '';
    const honeypot = typeof body?.company === 'string' ? body.company.trim() : '';

    // The "company" field is visually hidden in the form — only bots fill it.
    if (honeypot) {
      return NextResponse.json({ success: true }, { headers: cors });
    }

    if (!isValidContactEmail(email)) {
      return NextResponse.json({ error: 'Ogiltig e-postadress' }, { status: 400, headers: cors });
    }
    if (message.length < 5 || message.length > CONTACT_MESSAGE_MAX) {
      return NextResponse.json({ error: 'Ogiltigt meddelande' }, { status: 400, headers: cors });
    }

    // Same customer-context enrichment as the webhook entry point, but
    // best-effort: a failing integration must never block the submission.
    let context: Record<string, unknown> = {};
    try {
      const integrations = await prisma.integration.findMany({
        where: { tenantId, isActive: true },
      });
      context = await new ContextAggregator().gatherContext(email, integrations as any);
    } catch (error) {
      console.error('[contact-form] context aggregation failed:', error);
    }

    const { ticket, created } = await upsertTicket({
      tenantId,
      customerEmail: email,
      customerName: name || null,
      subject: deriveSubject(message),
      originalMessage: buildContactTicketMessage({ message, aiAnswer }),
      status: 'new',
      priority: 'normal',
      contextData: { ...context, source: 'contact_form', aiAnswerShown: aiAnswer.length > 0 },
    });

    // Deflection analytics: this question got past the AI and became a ticket.
    void logKbEvent(tenantId, { type: 'form_escalated', query: message.slice(0, 200) });

    // AI category for the reports (same hook as the mail sync). after() keeps
    // it alive past the response on serverless; classifyTicket never throws.
    if (created) {
      after(async () => {
        const category = await classifyTicket(deriveSubject(message), message);
        if (category) {
          await prisma.$executeRaw`
            UPDATE "Ticket" SET "category" = ${category} WHERE id = ${ticket.id}
          `;
        }
      });
    }

    return NextResponse.json({ success: true, ticketId: ticket.id, merged: !created }, { headers: cors });
  } catch (error) {
    console.error('[contact-form] submit error:', error);
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500, headers: cors });
  }
}
