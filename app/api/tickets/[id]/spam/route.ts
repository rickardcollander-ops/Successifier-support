import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireApiAuth } from '@/lib/api-auth';
import { findScopedTicket } from '@/lib/db/scoped';
import { logTicketEvent, TICKET_EVENT, EVENT_ACTOR } from '@/lib/services/ticket-events';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;

    const existing = await findScopedTicket(id);
    if (!existing) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Mark ticket as spam by updating status to 'closed' and adding spam marker
    const ticket = await prisma.ticket.update({
      where: { id: existing.id },
      data: {
        status: 'closed',
        originalMessage: `[SPAM] ${existing.originalMessage}`,
      },
    });

    if (existing.status !== 'closed') {
      await logTicketEvent(prisma, {
        tenantId: existing.tenantId,
        ticketId: existing.id,
        type: TICKET_EVENT.statusChanged,
        actor: EVENT_ACTOR.api,
        fromValue: existing.status,
        toValue: 'closed',
        meta: { spam: true },
      });
    }

    return NextResponse.json(ticket);
  } catch (error) {
    console.error('Error marking ticket as spam:', error);
    return NextResponse.json(
      { error: 'Failed to mark ticket as spam' },
      { status: 500 }
    );
  }
}
