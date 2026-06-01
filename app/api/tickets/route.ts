import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { upsertTicket } from '@/lib/services/deduplicator';

const ZENDESK_IMPORT_MARKER = '[Zendesk Import Source:';

// Strip the heavy attachment `dataUrl` payloads from list responses. The
// tickets page polls this endpoint every 3 seconds for ALL tickets, so
// shipping multi-MB image/PDF data URLs each time would be very wasteful.
// We keep lightweight metadata (filename/mimeType/size) so the UI can show
// counts and a loading state; the detail view lazy-loads the full bytes
// from the single-ticket endpoint (/api/tickets/[id]).
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
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

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

    // Default: exclude archived and Zendesk imports (include duplicates so they appear in tab)
    const tickets = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        status: { notIn: ['archived'] },
        NOT: {
          originalMessage: {
            contains: ZENDESK_IMPORT_MARKER,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ tickets: stripAttachmentData(tickets) });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tickets' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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
      originalMessage,
      priority: priority || 'normal',
      status: 'new',
    });

    if (created) {
      generateAIResponse(subject, originalMessage, null, tenant.id, ticket.id, customerEmail, customerName || undefined)
        .then(async ({ response, confidence }) => {
          // Raw SQL so we don't bump updatedAt — AI generation is not
          // customer activity and should not reorder the ticket list.
          await prisma.$executeRaw`
            UPDATE "Ticket"
            SET "aiResponse" = ${response},
                "aiConfidence" = ${confidence}
            WHERE id = ${ticket.id}
          `;
          console.log(`AI response generated for ticket ${ticket.id} with ${Math.round(confidence * 100)}% confidence`);
        })
        .catch((error) => {
          console.error(`Failed to generate AI response for ticket ${ticket.id}:`, error);
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
