import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireSuperadmin } from '@/lib/api-auth';

// Identify tickets where the previous bug silently buried a customer
// reply: status was set to "sent" or "closed", a follow-up email
// landed afterwards (so the ticket has at least one [Följdmail …]
// block in its originalMessage), and the status was preserved instead
// of being moved back to in_progress. These customers might be
// waiting for a response that never came.
//
// Heuristic — the dedup logic stamps every appended customer message
// with "[Följdmail <timestamp>]" and a fresh "[Gmail ID: …]" line.
// Counting those tells us how many customer messages went unread.
//
// Returns:
//   { count, totalUnseenReplies, tickets: [{ id, customerEmail,
//     customerName, subject, status, sentAt, repliesAfterClose,
//     lastFollowupAt, ticketUrl }] }
//
// Auth: any signed-in agent (same gate as the rest of the admin
// surface — Ida/Malin/Filippa).
export async function GET(request: NextRequest) {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  const tenant = await getTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  // We only care about tickets the agent considered resolved — those
  // are the ones where the bug could hide a fresh reply. Pull just the
  // columns we need; originalMessage can be large, so we read it
  // separately only on the candidates we care about.
  const candidates = await prisma.ticket.findMany({
    where: {
      tenantId: tenant.id,
      status: { in: ['sent', 'closed'] },
      // Has a buried customer reply, but hasn't been marked as handled.
      // The "[DrabbadHanterad …]" marker lets support clear the list once
      // they've dealt with (or dismissed) an entry so it stops re-appearing.
      AND: [
        { originalMessage: { contains: '[Följdmail' } },
        { NOT: { originalMessage: { contains: '[DrabbadHanterad' } } },
      ],
    },
    select: {
      id: true,
      customerEmail: true,
      customerName: true,
      subject: true,
      status: true,
      sentAt: true,
      updatedAt: true,
      originalMessage: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const affected = candidates.map((t) => {
    // Count "[Följdmail …]" blocks; each one represents a customer
    // message that landed after the original. The most-recent block
    // gives us a "last reply" timestamp for triage.
    const blocks = Array.from(
      t.originalMessage.matchAll(/\[Följdmail ([^\]]+)\]/g)
    );
    const lastFollowupAt = blocks.length > 0 ? blocks[blocks.length - 1][1] : null;
    return {
      id: t.id,
      customerEmail: t.customerEmail,
      customerName: t.customerName,
      subject: t.subject,
      status: t.status,
      sentAt: t.sentAt,
      repliesAfterOriginal: blocks.length,
      lastFollowupAt,
    };
  });

  // Sort by recency of last follow-up so the freshest "ghost replies"
  // come first.
  affected.sort((a, b) => {
    const aT = a.lastFollowupAt ? Date.parse(a.lastFollowupAt) : 0;
    const bT = b.lastFollowupAt ? Date.parse(b.lastFollowupAt) : 0;
    return bT - aT;
  });

  const uniqueEmails = Array.from(
    new Set(affected.map((a) => a.customerEmail.toLowerCase()))
  ).sort();

  return NextResponse.json({
    count: affected.length,
    uniqueCustomerCount: uniqueEmails.length,
    totalUnseenReplies: affected.reduce((s, a) => s + a.repliesAfterOriginal, 0),
    customerEmails: uniqueEmails,
    tickets: affected,
  });
}

// Mark one or more affected tickets as "handled" so they drop out of the
// list and stop re-appearing on every scan. Support asked for this because
// the reply-reopen fix means these customers already land correctly in the
// inboxes — the diagnostic list is now just noise that should be clearable.
//
// We tag the ticket with a hidden "[DrabbadHanterad: <ISO>]" marker rather
// than deleting anything. The marker is stripped from the conversation view
// and excluded from the GET query above.
export async function POST(request: NextRequest) {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  const tenant = await getTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  let ticketIds: string[] = [];
  try {
    const body = await request.json();
    if (Array.isArray(body?.ticketIds)) {
      ticketIds = body.ticketIds.filter((x: unknown): x is string => typeof x === 'string');
    }
  } catch {
    // fall through to validation below
  }

  if (ticketIds.length === 0) {
    return NextResponse.json({ error: 'ticketIds required' }, { status: 400 });
  }

  const marker = `\n[DrabbadHanterad: ${new Date().toISOString()} av ${authResult.userEmail}]`;

  let dismissed = 0;
  for (const id of ticketIds) {
    // Append the marker only if not already present; scope to this tenant.
    // Raw SQL so we don't bump updatedAt (these are resolved tickets and
    // shouldn't jump around in any activity-sorted view).
    const affectedRows = await prisma.$executeRaw`
      UPDATE "Ticket"
      SET "originalMessage" = "originalMessage" || ${marker}
      WHERE id = ${id}
        AND "tenantId" = ${tenant.id}
        AND "originalMessage" NOT LIKE '%[DrabbadHanterad%'
    `;
    dismissed += Number(affectedRows) || 0;
  }

  return NextResponse.json({ dismissed });
}
