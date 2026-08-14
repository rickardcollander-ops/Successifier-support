import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireApiAuth } from '@/lib/api-auth';
import { findScopedTicket } from '@/lib/db/scoped';

// The ticket's activity timeline: every logged event (created, inbound mail,
// status changes, assignments, replies, work started) in chronological order.
// Read straight off the (ticketId, createdAt) index — the same log the
// reports build on, finally visible on the ticket itself.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;

    // Tenant scoping: resolve the id through the deployment's tenant so a
    // valid session can never read another tenant's history.
    const ticket = await findScopedTicket(id);
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const events = await prisma.ticketEvent.findMany({
      where: { ticketId: ticket.id },
      select: {
        id: true,
        type: true,
        actor: true,
        fromValue: true,
        toValue: true,
        responseSeconds: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching ticket events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ticket events' },
      { status: 500 }
    );
  }
}
