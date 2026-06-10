import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { upsertTicket } from '@/lib/services/deduplicator';
import { sanitizeInboundText } from '@/lib/services/sanitize';
import { requireApiAuth } from '@/lib/api-auth';

const ZENDESK_IMPORT_MARKER = '[Zendesk Import Source:';

// Overlap subtracted from the client's `since` cursor so clock skew between
// app servers (Prisma sets @updatedAt client-side) and Postgres (raw-SQL
// writes use NOW()) can't make the delta poll miss a row. The client merge
// is idempotent, so re-sending a few rows is harmless.
const DELTA_OVERLAP_MS = 30_000;

// Strip the heavy attachment `dataUrl` payloads from list responses. The
// tickets page polls this endpoint every 3 seconds, so shipping multi-MB
// image/PDF data URLs each time would be very wasteful. We keep lightweight
// metadata (filename/mimeType/size) so the UI can show counts and a loading
// state; the detail view lazy-loads the full bytes from the single-ticket
// endpoint (/api/tickets/[id]).
function stripAttachmentData(tickets: any[]): any[] {
  return tickets.map((t) => {
    const ctx = t.contextData as Record<string, any> | null;
    if (!ctx || !Array.isArray(ctx.attachments) || ctx.attachments.length === 0) {
      return t;
    }
    return {
      ...t,
      contextData: {
        ...ctx,
        attachments: ctx.attachments.map((a: any) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
      },
    };
  });
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const sinceParam = searchParams.get('since');

    // Find tenant by subdomain
    const tenant = await getTenant();

    if (!tenant) {
      return NextResponse.json({ tickets: [] });
    }

    // If requesting archived tickets
    if (status === 'archived') {
      const tickets = await prisma.ticket.findMany({
        where: {
          tenantId: tenant.id,
          status: 'archived',
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return NextResponse.json({ tickets: stripAttachmentData(tickets) });
    }

    // Default scope: exclude archived and Zendesk imports (include
    // duplicates so they appear in their tab)
    const baseWhere: Prisma.TicketWhereInput = {
      tenantId: tenant.id,
      status: { notIn: ['archived'] },
      NOT: {
        originalMessage: {
          contains: ZENDESK_IMPORT_MARKER,
        },
      },
    };

    const serverTime = new Date().toISOString();

    // Delta poll: return only rows changed since the cursor, plus the id
    // set of everything currently visible so the client can drop tickets
    // that were deleted/archived elsewhere. Rows are only fully fetched
    // from the database when they actually changed — this is what keeps
    // the 3-second poll cheap (contextData can be megabytes per row).
    const since = sinceParam ? new Date(sinceParam) : null;
    if (since && !isNaN(since.getTime())) {
      const cursor = new Date(since.getTime() - DELTA_OVERLAP_MS);
      const [changed, idRows] = await Promise.all([
        prisma.ticket.findMany({
          where: {
            ...baseWhere,
            OR: [
              { updatedAt: { gt: cursor } },
              { contentRefreshedAt: { gt: cursor } },
              { createdAt: { gt: cursor } },
            ],
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.ticket.findMany({
          where: baseWhere,
          select: { id: true },
        }),
      ]);

      return NextResponse.json({
        delta: true,
        tickets: stripAttachmentData(changed),
        ids: idRows.map((r) => r.id),
        serverTime,
      });
    }

    const tickets = await prisma.ticket.findMany({
      where: baseWhere,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      tickets: stripAttachmentData(tickets),
      ids: tickets.map((t) => t.id),
      serverTime,
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tickets' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const { customerEmail, customerName, subject, originalMessage, priority } = body;

    if (!customerEmail || !subject || !originalMessage) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Find tenant by subdomain
    const tenant = await getTenant();

    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      );
    }

    const { ticket, created } = await upsertTicket({
      tenantId: tenant.id,
      customerEmail,
      customerName,
      subject,
      originalMessage: sanitizeInboundText(originalMessage),
      priority: priority || 'normal',
      status: 'new',
    });

    if (created) {
      // after() keeps the work alive past the response on serverless
      // hosts — a bare fire-and-forget promise gets frozen with the
      // function and the AI draft is silently lost.
      after(async () => {
        try {
          const { response, confidence } = await generateAIResponse(
            subject, originalMessage, null, tenant.id, ticket.id, customerEmail, customerName || undefined
          );
          // Raw SQL so we don't bump updatedAt — AI generation is not
          // customer activity and should not reorder the ticket list.
          await prisma.$executeRaw`
            UPDATE "Ticket"
            SET "aiResponse" = ${response},
                "aiConfidence" = ${confidence},
                "contentRefreshedAt" = NOW()
            WHERE id = ${ticket.id}
          `;
          console.log(`AI response generated for ticket ${ticket.id} with ${Math.round(confidence * 100)}% confidence`);
        } catch (error) {
          console.error(`Failed to generate AI response for ticket ${ticket.id}:`, error);
        }
      });
    }

    return NextResponse.json(ticket);
  } catch (error) {
    console.error('Error creating ticket:', error);
    return NextResponse.json(
      { error: 'Failed to create ticket' },
      { status: 500 }
    );
  }
}
