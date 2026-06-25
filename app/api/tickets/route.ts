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

// The tickets page polls this endpoint every 3 seconds. Two columns dominate
// the payload: `contextData` (a JSONB blob — attachment data URLs plus
// Stripe/Billecta/Clerk data, megabytes per row) and `finalResponse` (the full
// sent reply; ~4.7 MB across the open inbox here). Neither is needed in the
// list — TicketList renders neither, and TicketDetail lazy-loads the full
// ticket (contextData + finalResponse) from /api/tickets/[id] when a ticket is
// selected. So we select every scalar column EXCEPT those two for the list
// queries. (Prisma 5's `omit` is still behind a preview flag here, so we use an
// explicit select instead.)
const LIST_SELECT = {
  id: true,
  tenantId: true,
  customerEmail: true,
  customerName: true,
  subject: true,
  status: true,
  priority: true,
  originalMessage: true,
  aiResponse: true,
  aiConfidence: true,
  assignedTo: true,
  sentBy: true,
  sentAt: true,
  contentRefreshedAt: true,
  workStartedAt: true,
  activeWorkSeconds: true,
  createdAt: true,
  updatedAt: true,
} as const;

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
        select: LIST_SELECT,
      });
      return NextResponse.json({ tickets });
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
          select: LIST_SELECT,
        }),
        prisma.ticket.findMany({
          where: baseWhere,
          select: { id: true },
        }),
      ]);

      return NextResponse.json({
        delta: true,
        tickets: changed,
        ids: idRows.map((r) => r.id),
        serverTime,
      });
    }

    const tickets = await prisma.ticket.findMany({
      where: baseWhere,
      orderBy: { createdAt: 'desc' },
      select: LIST_SELECT,
    });

    return NextResponse.json({
      tickets,
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
