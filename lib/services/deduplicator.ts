import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';

// Window used to detect duplicates. Two messages from the same sender with
// the same normalized subject within this span are treated as the same
// conversation and merged into the same ticket. Widened to 10 minutes
// per support feedback: 5 minutes still let through bursts where Gmail
// delivers a copy a few minutes late.
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

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
  // Gmail thread id (msg.threadId from the Gmail API). Stored as a
  // marker in originalMessage so any future message in the same thread
  // — replies, follow-ups, however the subject changes — gets merged
  // into the original ticket. This is the most reliable dedup signal
  // we have; subject/sender heuristics still apply as a fallback.
  gmailThreadId?: string | null;
  // When set, the new message is appended to this exact ticket regardless
  // of how old it is — used for customer replies that should join the
  // original thread instead of opening a fresh ticket. Without this the
  // dedup window of 10 minutes would let any reply that arrives later
  // spawn a duplicate.
  threadParentTicketId?: string | null;
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

    // Helper to merge into an existing parent ticket. Used by both the
    // caller-supplied parent ID path and the Gmail thread-id lookup.
    const mergeInto = async (parent: { id: string; originalMessage: string; status: string }) => {
      if (
        input.gmailMessageId &&
        parent.originalMessage.includes(`[Gmail ID: ${input.gmailMessageId}]`)
      ) {
        const refreshed = await tx.ticket.findUnique({ where: { id: parent.id } });
        return { ticket: refreshed, created: false };
      }
      const separator = `\n\n---\n[Följdmail ${new Date().toLocaleString('sv-SE')}]\n`;
      // input.originalMessage from the sync route already starts with
      // "[Gmail ID: <id>]\n[Inbox account: …]\n\n<body>", so we just
      // append it as-is. Previously we re-prepended the Gmail ID which
      // produced duplicate "[Gmail ID: …]" lines in the merged ticket.
      const appendedBody = input.originalMessage;
      // If the parent had been considered "done" by support (sent or
      // closed), a fresh customer message means we missed something —
      // reopen it to Öppna so the new follow-up shows up in the active
      // queue instead of being buried. This is the stäng-ärende-buggen.
      const shouldReopen = parent.status === 'sent' || parent.status === 'closed';
      const updated = await tx.ticket.update({
        where: { id: parent.id },
        data: {
          originalMessage: `${parent.originalMessage}${separator}${appendedBody}`,
          ...(shouldReopen ? { status: 'in_progress' } : {}),
        },
      });
      return { ticket: updated, created: false };
    };

    // Caller already identified the parent thread (typically a customer
    // reply matching an older ticket via Re:/Sv: subject). Merge in
    // unconditionally when the parent still exists for this tenant.
    if (input.threadParentTicketId) {
      const parent = await tx.ticket.findFirst({
        where: {
          id: input.threadParentTicketId,
          tenantId: input.tenantId,
        },
      });
      if (parent) {
        const result = await mergeInto(parent);
        return result as UpsertTicketResult;
      }
    }

    // Gmail thread-id lookup. The thread id stays stable across an
    // entire conversation regardless of subject mangling ("Re: Re: Sv:")
    // or whether the customer trims/edits the subject line. This is
    // the most reliable way to keep follow-ups in the same ticket and
    // was added specifically to stop the recurring "original ticket
    // sneaks in alongside the reply" duplicate.
    if (input.gmailThreadId) {
      const threadMarker = `[Gmail Thread: ${input.gmailThreadId}]`;
      const parent = await tx.ticket.findFirst({
        where: {
          tenantId: input.tenantId,
          originalMessage: { contains: threadMarker },
          status: { notIn: ['archived', 'duplicate'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (parent) {
        const result = await mergeInto(parent);
        return result as UpsertTicketResult;
      }
    }

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
      const result = await mergeInto(match);
      return result as UpsertTicketResult;
    }

    // Embed the Gmail thread id as a marker in originalMessage so the
    // thread-id lookup above will find this ticket on the next message
    // in the conversation. Done as a marker (no schema change required)
    // so existing tickets without thread ids continue to work.
    const messagePrefix = input.gmailThreadId
      ? `[Gmail Thread: ${input.gmailThreadId}]\n`
      : '';

    const created = await tx.ticket.create({
      data: {
        tenantId: input.tenantId,
        customerEmail: input.customerEmail,
        customerName: input.customerName ?? null,
        subject: input.subject,
        originalMessage: `${messagePrefix}${input.originalMessage}`,
        status: input.status ?? 'new',
        priority: input.priority ?? 'normal',
        contextData: (input.contextData ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    return { ticket: created, created: true };
  });
}
