// The public event catalogue. These names are part of the API contract the
// Developer Portal documents — rename one and every customer integration
// breaks, so add new ones instead.

export const WEBHOOK_EVENTS = [
  {
    type: 'ticket.created',
    description: 'A new ticket was opened — via the API, the inbound webhook, a contact form or an inbox sync.',
  },
  {
    type: 'ticket.updated',
    description: 'Status, priority, assignee or the customer fields on a ticket changed.',
  },
  {
    type: 'ticket.ai_response_generated',
    description: 'The AI draft for a ticket finished generating (it is null on ticket.created).',
  },
  {
    type: 'ticket.response_sent',
    description: 'A reply was sent to the customer.',
  },
  {
    type: 'ping',
    description: 'Test delivery, sent only when you press "Send test" in the portal.',
  },
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]['type'];

export const WEBHOOK_EVENT_TYPES: string[] = WEBHOOK_EVENTS.map((e) => e.type);

/** Event types a customer may subscribe to (`ping` is always delivered). */
export const SUBSCRIBABLE_EVENT_TYPES: string[] = WEBHOOK_EVENT_TYPES.filter((t) => t !== 'ping');

/**
 * Does an endpoint subscribed to `events` want `event`?
 *
 * An empty subscription list means "everything", so an endpoint registered
 * today keeps receiving event types we add tomorrow without the customer
 * having to come back and re-register. `ping` is a test delivery aimed at
 * one specific endpoint and is therefore never filtered out.
 */
export function subscribesTo(events: string[] | null | undefined, event: string): boolean {
  if (event === 'ping') return true;
  if (!events || events.length === 0) return true;
  return events.includes(event);
}

/** Reject unknown event names at the API edge rather than silently storing typos. */
export function normalizeSubscription(events: unknown): { ok: true; events: string[] } | { ok: false; invalid: string[] } {
  if (events === undefined || events === null) return { ok: true, events: [] };
  if (!Array.isArray(events)) return { ok: false, invalid: ['events must be an array'] };
  const cleaned = Array.from(new Set(events.map((e) => String(e).trim()).filter(Boolean)));
  const invalid = cleaned.filter((e) => !SUBSCRIBABLE_EVENT_TYPES.includes(e));
  if (invalid.length) return { ok: false, invalid };
  return { ok: true, events: cleaned };
}

type TicketLike = {
  id: string;
  tenantId?: string;
  customerEmail: string;
  customerName?: string | null;
  subject: string;
  status: string;
  priority: string;
  category?: string | null;
  originalMessage?: string | null;
  aiResponse?: string | null;
  aiConfidence?: number | null;
  finalResponse?: string | null;
  assignedTo?: string | null;
  sentBy?: string | null;
  sentAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * The ticket shape we put on the wire. Deliberately a subset: `contextData`
 * is excluded because it carries whatever the connected systems returned
 * about the customer (Stripe/Billecta records, mail attachments) and a
 * webhook receiver has not asked for — and should not silently get — that.
 */
export function ticketEventData(ticket: TicketLike): Record<string, unknown> {
  return {
    id: ticket.id,
    customerEmail: ticket.customerEmail,
    customerName: ticket.customerName ?? null,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category ?? null,
    originalMessage: ticket.originalMessage ?? null,
    aiResponse: ticket.aiResponse ?? null,
    aiConfidence: ticket.aiConfidence ?? null,
    finalResponse: ticket.finalResponse ?? null,
    assignedTo: ticket.assignedTo ?? null,
    sentBy: ticket.sentBy ?? null,
    sentAt: iso(ticket.sentAt),
    createdAt: iso(ticket.createdAt),
    updatedAt: iso(ticket.updatedAt),
  };
}

export interface WebhookEnvelope {
  id: string;
  type: string;
  createdAt: string;
  tenantId: string;
  data: Record<string, unknown>;
}

export function buildEnvelope(params: {
  id: string;
  type: string;
  tenantId: string;
  data: Record<string, unknown>;
  createdAt?: Date;
}): WebhookEnvelope {
  return {
    id: params.id,
    type: params.type,
    createdAt: (params.createdAt ?? new Date()).toISOString(),
    tenantId: params.tenantId,
    data: params.data,
  };
}
