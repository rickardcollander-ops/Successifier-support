import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireCronSecret } from '@/lib/cron-auth';
import { classifyTicket } from '@/lib/services/ticket-classifier';
import { ZENDESK_IMPORT_MARKER } from '@/lib/reports/compute';

// Self-driving category backfill: classifies a small batch of historical
// (category IS NULL) tickets on each Vercel Cron invocation until the
// backlog is empty, then no-ops. Runs inside the deployment, so it uses the
// DATABASE_URL and ANTHROPIC_API_KEY already configured there — no secrets
// need to leave Vercel and nobody has to run scripts/oneoff/
// backfill-categories.mjs by hand. Each deployment (doldadress, serus)
// backfills its own tenant with its own category list automatically.
//
// Safe by construction: only NULL categories are touched (same as the
// oneoff script), Zendesk imports are excluded, and classifyTicket never
// throws — a failed classification just leaves the ticket for a later run.
// Once `remaining` reports 0 the cron entry in vercel.json can be removed,
// but leaving it is harmless (each no-op run is one cheap count query).

// Keep well inside the function time limit: ~1–2s per Haiku call.
export const maxDuration = 60;
const BATCH_SIZE = 15;

// The customer's original question: first thread segment, minus sync
// metadata headers (same reduction as the oneoff backfill script and the
// reports drill-down).
function questionText(originalMessage: string): string {
  return originalMessage
    .replace(/\[Gmail ID:.*?\]\n?(\[Message-Id:.*?\]\n?)?(\[Inbox account:.*?\]\n?)?\n?/g, '')
    .split(/\n---\n/)[0]
    .trim();
}

export async function GET(request: NextRequest) {
  const authResult = requireCronSecret(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenant = await getTenant();
    if (!tenant) {
      return NextResponse.json({ skipped: 'no tenant' });
    }

    const uncategorised = {
      tenantId: tenant.id,
      category: null,
      NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
    };

    const batch = await prisma.ticket.findMany({
      where: uncategorised,
      select: { id: true, subject: true, originalMessage: true },
      // Newest first: the recent history is what the report windows show,
      // so it becomes useful immediately while older tickets catch up.
      orderBy: { createdAt: 'desc' },
      take: BATCH_SIZE,
    });

    let categorised = 0;
    for (const ticket of batch) {
      const category = await classifyTicket(ticket.subject, questionText(ticket.originalMessage));
      if (category) {
        // Raw SQL so updatedAt stays untouched (same as the live hooks).
        await prisma.$executeRaw`
          UPDATE "Ticket" SET "category" = ${category} WHERE id = ${ticket.id}
        `;
        categorised += 1;
      }
    }

    const remaining = await prisma.ticket.count({ where: uncategorised });
    return NextResponse.json({ processed: batch.length, categorised, remaining });
  } catch (error) {
    console.error('Error backfilling categories:', error);
    return NextResponse.json({ error: 'Failed to backfill categories' }, { status: 500 });
  }
}
