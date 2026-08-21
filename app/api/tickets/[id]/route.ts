import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireApiAuth } from '@/lib/api-auth';
import { findScopedTicket } from '@/lib/db/scoped';
import { auth } from '@/lib/auth';
import { queueTicketWebhook } from '@/lib/webhooks/dispatch';
import {
  eventsFromTicketPatch,
  eventActor,
  logTicketEvents,
  EVENT_ACTOR,
} from '@/lib/services/ticket-events';

// Fields a client may set via PATCH. Everything else (tenantId, sentBy,
// aiConfidence, contextData, timestamps…) is server-managed; spreading the
// raw body into prisma.update would let any client rewrite them.
const PATCHABLE_FIELDS = [
  'status',
  'priority',
  'assignedTo',
  'customerEmail',
  'customerName',
  'subject',
  'aiResponse',
  'finalResponse',
  'originalMessage',
] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;

    const ticket = await findScopedTicket(id);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(ticket);
  } catch (error) {
    console.error('Error fetching ticket:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ticket' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const { id } = await params;

    const existing = await findScopedTicket(id);
    if (!existing) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    for (const field of PATCHABLE_FIELDS) {
      if (field in body) data[field] = body[field];
    }

    // Stamp the first moment a human starts working on this ticket so reports
    // can show average active handling time (sentAt − workStartedAt), separate
    // from total response time. "Work started" = the ticket leaves the
    // unworked "new" status, gets assigned to an agent, or the agent starts
    // composing a reply (finalResponse set). Note: AI draft generation does
    // NOT count — that's automatic, not human effort. Set once and never
    // overwritten, so reopened/re-touched tickets keep the original start.
    const WORKING_STATUSES = new Set(['in_progress', 'waiting_ai', 'review']);
    if (!existing.workStartedAt) {
      const startsWorking =
        (typeof data.status === 'string' && WORKING_STATUSES.has(data.status)) ||
        (typeof data.assignedTo === 'string' && data.assignedTo.trim() !== '') ||
        (typeof data.finalResponse === 'string' && data.finalResponse.trim() !== '');
      if (startsWorking) data.workStartedAt = new Date();
    }

    const ticket = await prisma.ticket.update({
      where: { id: existing.id },
      data,
    });

    // Event log: status changes, assignments and work-start, credited to the
    // signed-in agent when there is one (API-key calls fall back to 'api').
    // After the primary write and error-swallowing, so a logging hiccup can
    // never fail the PATCH itself.
    let actor: string | null = null;
    try {
      const session = await auth();
      actor = eventActor(session?.user?.name || session?.user?.email);
    } catch {
      actor = null;
    }
    await logTicketEvents(
      prisma,
      eventsFromTicketPatch(existing, data, actor ?? EVENT_ACTOR.api)
    );

    // Outbound webhook for integrators mirroring ticket state into their
    // own systems. Queued so a slow receiver can't stall the PATCH.
    queueTicketWebhook('ticket.updated', ticket);

    return NextResponse.json(ticket);
  } catch (error) {
    console.error('Error updating ticket:', error);
    return NextResponse.json(
      { error: 'Failed to update ticket' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    await prisma.ticket.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    return NextResponse.json(
      { error: 'Failed to delete ticket' },
      { status: 500 }
    );
  }
}
