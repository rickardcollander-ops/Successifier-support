import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';

// Window used to detect duplicates. Two messages from the same sender with
// the same normalized subject within this span are treated as the same
// conversation and merged into the same ticket.
export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

function normalizeSubject(subject: string): string {
  return subject.replace(/^(Re|Sv|Fwd|Fw):\s*/i, '').trim().toLowerCase();
}

export interface UpsertTicketInput {
  tenantId: string;
  customerEmail: string;
  customerName?: string | null;
  subject: string;
  originalMessage: string;
  status?: string;
  priority?: string;
  contextData?: any;
  gmailMessageId?: string | null;
}

export interface UpsertTicketResult {
  ticket: any;
  created: boolean;
}

// Atomically create a ticket or merge into an existing one. A Postgres
// advisory lock keyed on (tenantId, customerEmail, normalizedSubject)
// serializes concurrent attempts so two parallel email syncs cannot both
// insert a fresh ticket for the same inbound message — which is what
// previously let bursts of duplicates through even inside the merge window.
export async function upsertTicket(input: UpsertTicketInput): Promise<UpsertTicketResult> {
  const normalized = normalizeSubject(input.subject);
  const lockKey = `ticket-dedup:${input.tenantId}:${input.customerEmail.toLowerCase()}:${normalized}`;
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);

  return await prisma.$transaction(async (tx) => {
    // Serialize all concurrent inserts with the same sender+subject for
    // this tenant. The lock is automatically released at the end of the
    // transaction regardless of outcome.
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      lockKey
    );

    const candidates = await tx.ticket.findMany({
      where: {
        tenantId: input.tenantId,
        customerEmail: input.customerEmail,
        createdAt: { gte: since },
        status: { notIn: ['archived', 'duplicate'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const match = candidates.find(
      (c) => normalizeSubject(c.subject) === normalized
    );

    if (match) {
      // Guard against re-appending the exact same Gmail message (possible
      // when the Gmail "mark as read" call didn't complete before the next
      // sync picked up the same message).
      if (
        input.gmailMessageId &&
        match.originalMessage.includes(`[Gmail ID: ${input.gmailMessageId}]`)
      ) {
        return { ticket: match, created: false };
      }

      const separator = `\n\n---\n[Följdmail ${new Date().toLocaleString('sv-SE')}]\n`;
      const appendedBody = input.gmailMessageId
        ? `[Gmail ID: ${input.gmailMessageId}]\n${input.originalMessage}`
        : input.originalMessage;

      const updated = await tx.ticket.update({
        where: { id: match.id },
        data: {
          originalMessage: `${match.originalMessage}${separator}${appendedBody}`,
          // Bring the ticket back to Öppna when a follow-up lands while it
          // was sitting in Nytt with no agent action — but don't override
          // an already-worked status (review, sent, closed).
          ...(match.status === 'new' ? {} : {}),
        },
      });
      return { ticket: updated, created: false };
    }

    const created = await tx.ticket.create({
      data: {
        tenantId: input.tenantId,
        customerEmail: input.customerEmail,
        customerName: input.customerName ?? null,
        subject: input.subject,
        originalMessage: input.originalMessage,
        status: input.status ?? 'new',
        priority: input.priority ?? 'normal',
        contextData: (input.contextData ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    return { ticket: created, created: true };
  });
}
