import type { Prisma, PrismaClient } from '@prisma/client';
import { resolveAgentName } from '@/lib/agent-match';

// Append-only activity log for tickets (the TicketEvent table). The Ticket
// row can't answer "when did this change status?" or "when was each reply
// sent?" — sentAt/sentBy are overwritten on every reply and status changes
// leave no trace. Every code path that mutates status/assignedTo or
// sends/receives a message calls into here; reports and the bemanning page
// read the log back out.

export const TICKET_EVENT = {
  created: 'created',
  inboundReceived: 'inbound_received',
  statusChanged: 'status_changed',
  assigned: 'assigned',
  replySent: 'reply_sent',
  workStarted: 'work_started',
} as const;

export type TicketEventType = (typeof TICKET_EVENT)[keyof typeof TICKET_EVENT];

// System actors, used when no signed-in agent is behind the change.
export const EVENT_ACTOR = {
  system: 'system',
  gmailSync: 'gmail-sync',
  api: 'api',
  backfill: 'backfill',
} as const;

export interface TicketEventInput {
  tenantId: string;
  ticketId: string;
  type: TicketEventType;
  actor?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  responseSeconds?: number | null;
  meta?: Prisma.InputJsonValue;
  // Anchor the event to the real moment it happened (a mail's arrival time,
  // a backfilled reply's timestamp). Omitted = insert time.
  createdAt?: Date;
}

// Both the global client and a $transaction client can write events — the
// deduplicator passes its tx so an event insert rolls back together with the
// merge it describes.
type EventDb = Pick<PrismaClient, 'ticketEvent'> | Prisma.TransactionClient;

// Resolve a raw sentBy/assignedTo/session value to what the event log stores:
// the canonical agent name when it matches a known agent, otherwise the raw
// value itself (an unknown name is still information — don't erase it).
export function eventActor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return resolveAgentName(raw) ?? raw;
}

// NEVER throws — event logging is bookkeeping and must not break a send or
// a sync. Inside a transaction a failed insert still aborts the tx (Postgres
// poisons it), which is the consistent outcome there.
export async function logTicketEvent(db: EventDb, event: TicketEventInput): Promise<void> {
  try {
    await db.ticketEvent.create({ data: event });
  } catch (error) {
    console.error('Failed to log ticket event:', error);
  }
}

export async function logTicketEvents(db: EventDb, events: TicketEventInput[]): Promise<void> {
  if (events.length === 0) return;
  try {
    await db.ticketEvent.createMany({ data: events });
  } catch (error) {
    console.error('Failed to log ticket events:', error);
  }
}

// Diff a ticket PATCH into events — pure, so it's unit-testable. Only actual
// changes produce events; a PATCH re-sending the current status is a no-op.
export function eventsFromTicketPatch(
  existing: { id: string; tenantId: string; status: string; assignedTo: string | null },
  data: Record<string, unknown>,
  actor: string | null
): TicketEventInput[] {
  const events: TicketEventInput[] = [];
  const base = { tenantId: existing.tenantId, ticketId: existing.id, actor };

  if (typeof data.status === 'string' && data.status !== existing.status) {
    events.push({
      ...base,
      type: TICKET_EVENT.statusChanged,
      fromValue: existing.status,
      toValue: data.status,
    });
  }
  if (
    typeof data.assignedTo === 'string' &&
    data.assignedTo !== (existing.assignedTo ?? '')
  ) {
    events.push({
      ...base,
      type: TICKET_EVENT.assigned,
      fromValue: existing.assignedTo ?? null,
      toValue: data.assignedTo || null,
    });
  }
  if (data.workStartedAt instanceof Date) {
    events.push({ ...base, type: TICKET_EVENT.workStarted });
  }
  return events;
}

// Seconds from the customer's latest message (or the ticket's creation) to a
// reply sent at `sentAt` — the per-reply response time stored on reply_sent
// events. One small query on the (ticketId, createdAt) index.
export async function replyResponseSeconds(
  db: EventDb,
  ticket: { id: string; createdAt: Date },
  sentAt: Date
): Promise<number | null> {
  try {
    const lastInbound = await db.ticketEvent.findFirst({
      where: {
        ticketId: ticket.id,
        type: { in: [TICKET_EVENT.inboundReceived, TICKET_EVENT.created] },
        createdAt: { lte: sentAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const anchor = Math.max(
      lastInbound?.createdAt.getTime() ?? 0,
      ticket.createdAt.getTime()
    );
    const seconds = Math.round((sentAt.getTime() - anchor) / 1000);
    return seconds >= 0 ? seconds : null;
  } catch (error) {
    console.error('Failed to compute reply response time:', error);
    return null;
  }
}
