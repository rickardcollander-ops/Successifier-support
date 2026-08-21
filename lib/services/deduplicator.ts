import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';
import { logTicketEvent, TICKET_EVENT, EVENT_ACTOR } from '@/lib/services/ticket-events';
import { queueTicketWebhook } from '@/lib/webhooks/dispatch';

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
  // RFC 2822 Message-Id from the email's headers. Unlike Gmail's
  // per-account message.id this value is identical across every
  // inbox that received the same physical mail, so we use it as the
  // cross-account dedup signal in the merge path as well.
  rfcMessageId?: string | null;
  // When set, the new message is appended to this exact ticket regardless
  // of how old it is — used for customer replies that should join the
  // original thread instead of opening a fresh ticket. Without this the
  // dedup window of 10 minutes would let any reply that arrives later
  // spawn a duplicate.
  threadParentTicketId?: string | null;
  // Real arrival time of the mail (e.g. Gmail's internalDate). When set
  // we use this as the ticket's createdAt so the list shows the actual
  // send time of the email instead of the sync timestamp. Without it,
  // a batch of 20 mails synced together all get clustered to the same
  // second and the order in the UI becomes arbitrary.
  receivedAt?: Date | null;
}

export interface UpsertTicketResult {
  ticket: any;
  created: boolean;
  // True when a new inbound message was appended to an existing ticket
  // (as opposed to a duplicate we skipped without changing anything).
  // Callers use this to regenerate the AI draft from the full thread.
  merged: boolean;
}

// Atomically create a ticket or merge into an existing one. A Postgres
// advisory lock keyed on (tenantId, customerEmail, normalizedSubject)
// serializes concurrent attempts so two parallel email syncs cannot both
// insert a fresh ticket for the same inbound message — which is what
// previously let bursts of duplicates through even inside the merge window.
export async function upsertTicket(input: UpsertTicketInput): Promise<UpsertTicketResult> {
  const normalized = normalizeSubject(input.subject);
  const lockKey = `ticket-dedup:${input.tenantId}:${input.customerEmail.toLowerCase()}:${normalized}`;
  // Anchor the dedup window to the email's own arrival time so batched
  // syncs don't miss duplicates that arrived minutes before the sync ran.
  const refTime = (input.receivedAt ?? new Date()).getTime();
  const since = new Date(refTime - DUPLICATE_WINDOW_MS);

  const result = await prisma.$transaction(async (tx) => {
    // Serialize all concurrent inserts with the same sender+subject for
    // this tenant. The lock is automatically released at the end of the
    // transaction regardless of outcome.
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      lockKey
    );

    // Helper to merge into an existing parent ticket. Used by both the
    // caller-supplied parent ID path and the Gmail thread-id lookup.
    const mergeInto = async (parent: { id: string; originalMessage: string; status: string; contextData?: any }) => {
      if (
        input.gmailMessageId &&
        parent.originalMessage.includes(`[Gmail ID: ${input.gmailMessageId}]`)
      ) {
        const refreshed = await tx.ticket.findUnique({ where: { id: parent.id } });
        return { ticket: refreshed, created: false, merged: false };
      }
      const separator = `\n\n---\n[Följdmail ${(input.receivedAt ?? new Date()).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}]\n`;
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

      // Carry attachments from the follow-up into the ticket. The merge
      // path used to ignore contextData entirely, so any image/PDF a
      // customer sent in a reply was lost and only viewable in Gmail. We
      // append the new attachments to whatever the parent already had,
      // de-duplicated by filename+size so the same mail synced twice
      // doesn't double them up.
      const incomingAttachments = Array.isArray(input.contextData?.attachments)
        ? input.contextData.attachments
        : [];
      let contextDataUpdate: { contextData?: Prisma.InputJsonValue } = {};
      if (incomingAttachments.length > 0) {
        const parentContext = (parent.contextData as Record<string, any> | null) ?? {};
        const existing = Array.isArray(parentContext.attachments) ? parentContext.attachments : [];
        const seen = new Set(existing.map((a: any) => `${a.filename}:${a.size ?? ''}`));
        const additions = incomingAttachments.filter(
          (a: any) => !seen.has(`${a.filename}:${a.size ?? ''}`),
        );
        if (additions.length > 0) {
          contextDataUpdate = {
            contextData: {
              ...parentContext,
              attachments: [...existing, ...additions],
            } as Prisma.InputJsonValue,
          };
        }
      }

      const updated = await tx.ticket.update({
        where: { id: parent.id },
        data: {
          originalMessage: `${parent.originalMessage}${separator}${appendedBody}`,
          ...(shouldReopen ? { status: 'in_progress' } : {}),
          ...contextDataUpdate,
        },
      });
      // Event log: the customer's message, anchored to its real arrival
      // time, plus the reopen when the ticket had been considered done.
      // Written on the tx client so the log stays consistent with the merge.
      await logTicketEvent(tx, {
        tenantId: input.tenantId,
        ticketId: parent.id,
        type: TICKET_EVENT.inboundReceived,
        actor: EVENT_ACTOR.system,
        createdAt: input.receivedAt ?? undefined,
      });
      if (shouldReopen) {
        await logTicketEvent(tx, {
          tenantId: input.tenantId,
          ticketId: parent.id,
          type: TICKET_EVENT.statusChanged,
          actor: EVENT_ACTOR.system,
          fromValue: parent.status,
          toValue: 'in_progress',
        });
      }
      return { ticket: updated, created: false, merged: true };
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
        ...(input.receivedAt ? { createdAt: input.receivedAt } : {}),
      },
    });

    // Event log: every creation path (sync, webhook, manual POST) funnels
    // through here, so this single hook covers them all. Anchored to the
    // ticket's own createdAt (= the mail's arrival time when known).
    await logTicketEvent(tx, {
      tenantId: input.tenantId,
      ticketId: created.id,
      type: TICKET_EVENT.created,
      actor: EVENT_ACTOR.system,
      createdAt: created.createdAt,
    });

    return { ticket: created, created: true, merged: false };
  });

  // Outbound webhooks. Every creation path (API, inbound webhook, Gmail
  // sync, contact form) funnels through here, so registering the hook once
  // at this choke point is what makes the public event stream complete.
  // Queued, never awaited: a customer's slow receiver must not slow down
  // ticket intake.
  if (result.ticket) {
    if (result.created) {
      queueTicketWebhook('ticket.created', result.ticket, input.tenantId);
    } else if (result.merged) {
      queueTicketWebhook('ticket.updated', result.ticket, input.tenantId);
    }
  }

  return result;
}
