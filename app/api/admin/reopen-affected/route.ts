import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireSuperadmin } from '@/lib/api-auth';
import { logTicketEvents, TICKET_EVENT, EVENT_ACTOR } from '@/lib/services/ticket-events';

// Reopen every ticket that's still sitting in "sent" or "closed" with at
// least one customer follow-up appended after the agent considered it
// done. Those are the tickets that were silently buried by the
// stäng-ärende-bugg — see /api/admin/affected-by-closed-reply-bug for
// the read-only listing. This endpoint flips them all back to
// in_progress so support sees them in Öppna and can respond.
export async function POST(request: NextRequest) {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  const tenant = await getTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  // Fetch the affected ids/statuses first so the event log records the
  // actual from-status of each reopened ticket (updateMany can't return them).
  const affected = await prisma.ticket.findMany({
    where: {
      tenantId: tenant.id,
      status: { in: ['sent', 'closed'] },
      originalMessage: { contains: '[Följdmail' },
    },
    select: { id: true, status: true },
  });

  const result = await prisma.ticket.updateMany({
    where: { id: { in: affected.map((t) => t.id) } },
    data: { status: 'in_progress' },
  });

  await logTicketEvents(
    prisma,
    affected.map((t) => ({
      tenantId: tenant.id,
      ticketId: t.id,
      type: TICKET_EVENT.statusChanged,
      actor: EVENT_ACTOR.api,
      fromValue: t.status,
      toValue: 'in_progress',
      meta: { bulk: 'reopen-affected' },
    }))
  );

  return NextResponse.json({
    success: true,
    reopened: result.count,
  });
}
