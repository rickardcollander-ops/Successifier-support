import crypto from 'crypto';
import { after } from 'next/server';
import { prisma } from '@/lib/db/client';
import { decryptIfEncrypted } from '@/lib/crypto';
import {
  buildEnvelope,
  subscribesTo,
  ticketEventData,
  type WebhookEnvelope,
} from '@/lib/webhooks/events';
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  webhookSignatureHeader,
} from '@/lib/webhooks/signature';

// How long a receiver gets to answer one attempt.
const TIMEOUT_MS = 10_000;
// Attempt schedule. A receiver that is briefly down (deploy, restart)
// should not cost the customer the event.
const RETRY_DELAYS_MS = [0, 1_000, 3_000];
// Consecutive failed deliveries before we stop hammering a dead endpoint.
// The endpoint is disabled, not deleted — the portal shows why and the
// customer re-enables it with one click once their side is back.
const AUTO_DISABLE_AFTER = 15;
// Deliveries kept per endpoint. Enough to debug an integration, not enough
// to grow into a second ticket table.
const MAX_DELIVERY_LOG = 50;

export interface DeliveryResult {
  ok: boolean;
  statusCode: number | null;
  attempts: number;
  error: string | null;
  durationMs: number;
}

type EndpointRow = {
  id: string;
  tenantId: string;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Truncate whatever the receiver said so one chatty error page can't fill a column. */
function shortError(message: string): string {
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

async function attemptDelivery(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; statusCode: number | null; error: string | null }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { ok: true, statusCode: response.status, error: null };

    // Read a little of the body so the delivery log can show WHY the
    // receiver rejected it, which is the whole point of the log.
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      detail = '';
    }
    return {
      ok: false,
      statusCode: response.status,
      error: shortError(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`),
    };
  } catch (error: any) {
    const name = error?.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS}ms` : error?.message;
    return { ok: false, statusCode: null, error: shortError(name || 'Request failed') };
  }
}

/**
 * Deliver one envelope to one endpoint, with retries, and record the
 * attempt. Never throws: a webhook is a side effect of someone else's
 * request and must not be able to fail it.
 */
export async function deliverToEndpoint(
  endpoint: EndpointRow,
  envelope: WebhookEnvelope,
): Promise<DeliveryResult> {
  const body = JSON.stringify(envelope);
  const secret = decryptIfEncrypted(endpoint.secret);
  const startedAt = Date.now();

  let last: { ok: boolean; statusCode: number | null; error: string | null } = {
    ok: false,
    statusCode: null,
    error: 'Not attempted',
  };
  let attempts = 0;

  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    attempts += 1;
    // Re-sign per attempt so a retry never arrives outside the receiver's
    // timestamp tolerance.
    const timestamp = Math.floor(Date.now() / 1000);
    last = await attemptDelivery(endpoint.url, body, {
      'Content-Type': 'application/json',
      'User-Agent': 'Successifier-Webhooks/1.0',
      [SIGNATURE_HEADER]: webhookSignatureHeader(body, secret, timestamp),
      [EVENT_HEADER]: envelope.type,
      [DELIVERY_HEADER]: envelope.id,
    });
    if (last.ok) break;
    // 4xx (other than 429) is the receiver saying "this request is wrong",
    // not "try again" — retrying just spams them.
    if (last.statusCode && last.statusCode >= 400 && last.statusCode < 500 && last.statusCode !== 429) break;
  }

  const result: DeliveryResult = {
    ok: last.ok,
    statusCode: last.statusCode,
    attempts,
    error: last.ok ? null : last.error,
    durationMs: Date.now() - startedAt,
  };

  await recordDelivery(endpoint, envelope, result);
  return result;
}

async function recordDelivery(
  endpoint: EndpointRow,
  envelope: WebhookEnvelope,
  result: DeliveryResult,
): Promise<void> {
  try {
    await prisma.webhookDelivery.create({
      data: {
        tenantId: endpoint.tenantId,
        endpointId: endpoint.id,
        event: envelope.type,
        payload: envelope as any,
        status: result.ok ? 'success' : 'failed',
        statusCode: result.statusCode,
        attempts: result.attempts,
        error: result.error,
        durationMs: result.durationMs,
      },
    });

    const failures = result.ok
      ? 0
      : (
          await prisma.webhookEndpoint.findUnique({
            where: { id: endpoint.id },
            select: { consecutiveFailures: true },
          })
        )?.consecutiveFailures ?? 0;
    const nextFailures = result.ok ? 0 : failures + 1;
    const autoDisable = nextFailures >= AUTO_DISABLE_AFTER;

    await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        lastDeliveryAt: new Date(),
        lastStatusCode: result.statusCode,
        lastError: result.error,
        consecutiveFailures: nextFailures,
        ...(autoDisable ? { isActive: false, autoDisabledAt: new Date() } : {}),
        ...(result.ok ? { autoDisabledAt: null } : {}),
      },
    });

    await trimDeliveryLog(endpoint.id);
  } catch (error) {
    console.error('Failed to record webhook delivery:', error);
  }
}

async function trimDeliveryLog(endpointId: string): Promise<void> {
  const cutoff = await prisma.webhookDelivery.findMany({
    where: { endpointId },
    orderBy: { createdAt: 'desc' },
    skip: MAX_DELIVERY_LOG,
    take: 1,
    select: { createdAt: true },
  });
  if (!cutoff.length) return;
  await prisma.webhookDelivery.deleteMany({
    where: { endpointId, createdAt: { lt: cutoff[0].createdAt } },
  });
}

async function activeEndpointsFor(tenantId: string, event: string): Promise<EndpointRow[]> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, tenantId: true, url: true, secret: true, events: true, isActive: true },
  });
  return endpoints.filter((e) => subscribesTo(e.events, event));
}

/**
 * Fan an event out to every endpoint in the tenant that subscribes to it.
 * Call it from `after()` so the customer's request is not held open by
 * someone else's server, and never `await` it on a hot path.
 */
export async function dispatchWebhookEvent(params: {
  tenantId: string;
  type: string;
  data: Record<string, unknown>;
}): Promise<void> {
  try {
    const endpoints = await activeEndpointsFor(params.tenantId, params.type);
    if (!endpoints.length) return;

    const envelope = buildEnvelope({
      id: `evt_${crypto.randomBytes(12).toString('hex')}`,
      type: params.type,
      tenantId: params.tenantId,
      data: params.data,
    });

    await Promise.all(endpoints.map((endpoint) => deliverToEndpoint(endpoint, envelope)));
  } catch (error) {
    console.error(`Failed to dispatch webhook ${params.type}:`, error);
  }
}

/**
 * Ticket-shaped convenience wrapper — the only entry point the ticket
 * routes need. Safe to call with a ticket row straight from Prisma.
 */
export async function emitTicketWebhook(
  type: string,
  ticket: Parameters<typeof ticketEventData>[0] & { tenantId?: string },
  tenantId?: string,
): Promise<void> {
  const resolved = tenantId ?? ticket.tenantId;
  if (!resolved) return;
  await dispatchWebhookEvent({ tenantId: resolved, type, data: ticketEventData(ticket) });
}

/** One-off delivery of a `ping` to a single endpoint, for the portal's test button. */
export async function sendTestDelivery(endpoint: EndpointRow): Promise<DeliveryResult> {
  const envelope = buildEnvelope({
    id: `evt_${crypto.randomBytes(12).toString('hex')}`,
    type: 'ping',
    tenantId: endpoint.tenantId,
    data: {
      message: 'Test delivery from the Developer Portal. If you can verify this signature, you are ready to receive real events.',
      endpointId: endpoint.id,
    },
  });
  return deliverToEndpoint(endpoint, envelope);
}

/**
 * Fire-and-forget an event from inside a request. Deliveries wait on someone
 * else's server, so they must never be awaited on a request path — but a bare
 * promise gets frozen with the serverless function, which is exactly how the
 * AI-draft work was lost before `after()`. Falls back to a detached promise
 * outside a request scope (scripts, cron handlers) where `after()` throws.
 */
export function queueTicketWebhook(
  type: string,
  ticket: Parameters<typeof ticketEventData>[0] & { tenantId?: string },
  tenantId?: string,
): void {
  const run = () =>
    emitTicketWebhook(type, ticket, tenantId).catch((error) =>
      console.error(`Failed to emit webhook ${type}:`, error),
    );
  try {
    after(run);
  } catch {
    void run();
  }
}
