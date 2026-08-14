// Backfill the TicketEvent log from existing Ticket rows, so first-response
// and replies-per-ticket metrics have history from day one instead of only
// filling forward. Reconstructs:
//   - 'created'          from ticket.createdAt
//   - 'work_started'     from ticket.workStartedAt
//   - 'reply_sent'       from the "[Support-svar <ts> av <agent>]" thread
//                        markers in originalMessage (system-written after
//                        sanitization — customers cannot forge them; see
//                        lib/services/ticket-thread.ts)
//   - 'inbound_received' from the "[Följdmail <ts>]" markers
//   - a final 'reply_sent' at sentAt when no marker matched it (pre-marker-era)
// Status history is NOT reconstructable and is not attempted.
//
// Idempotent: a ticket that already has a 'created' event (from a previous
// run or from the live emitter) is skipped. Zendesk-import tickets are
// excluded entirely, matching the reports population.
//
// Usage:
//   DRY_RUN=1 node scripts/oneoff/backfill-ticket-events.mjs   # count only
//   node scripts/oneoff/backfill-ticket-events.mjs
//   TENANT=serus node scripts/oneoff/backfill-ticket-events.mjs

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === '1';
const TENANT = process.env.TENANT || 'doldadress';

const ZENDESK_IMPORT_MARKER = '[Zendesk Import Source:';

// Thread separator written by send/route.ts and deduplicator.ts:
// "\n\n---\n[Support-svar 2026-06-10 14:32:11 av Ida Rosell]" /
// "\n\n---\n[Följdmail 2026-06-10 14:32:11]". Timestamps are
// toLocaleString('sv-SE', Europe/Stockholm) → "YYYY-MM-DD HH:MM:SS".
const MARKER_RE =
  /\n\n---\n\[(Följdmail|Support-svar) (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?: av ([^\]]+))?\]/g;

// Stockholm wall time → UTC instant (same math as lib/time/stockholm.ts,
// replicated because .mjs scripts can't import the TS lib).
function stockholmOffsetMs(utcMillis) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMillis));
  const m = {};
  for (const p of parts) if (p.type !== 'literal') m[p.type] = Number(p.value);
  const hour = m.hour === 24 ? 0 : m.hour;
  return Date.UTC(m.year, m.month - 1, m.day, hour, m.minute, m.second) - utcMillis;
}

function parseStockholmTimestamp(s) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  const parsed = new Date(guess - stockholmOffsetMs(guess));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { subdomain: TENANT },
    select: { id: true },
  });
  if (!tenant) throw new Error(`Tenant '${TENANT}' not found`);

  // Tickets that already have a 'created' event are done (live emitter or a
  // previous backfill run) — every backfilled ticket gets one.
  const doneRows = await prisma.ticketEvent.findMany({
    where: { tenantId: tenant.id, type: 'created' },
    select: { ticketId: true },
    distinct: ['ticketId'],
  });
  const done = new Set(doneRows.map((r) => r.ticketId));

  const tickets = await prisma.ticket.findMany({
    where: {
      tenantId: tenant.id,
      NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
    },
    select: {
      id: true,
      createdAt: true,
      workStartedAt: true,
      sentAt: true,
      sentBy: true,
      originalMessage: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const events = [];
  let skipped = 0;
  let parsedReplies = 0;
  let parsedInbound = 0;
  let sentAtFallbacks = 0;

  for (const t of tickets) {
    if (done.has(t.id)) {
      skipped += 1;
      continue;
    }
    const base = { tenantId: tenant.id, ticketId: t.id, meta: { backfill: true } };

    events.push({ ...base, type: 'created', actor: 'backfill', createdAt: t.createdAt });
    if (t.workStartedAt) {
      events.push({ ...base, type: 'work_started', actor: 'backfill', createdAt: t.workStartedAt });
    }

    // Walk the thread markers in order, tracking the latest inbound moment so
    // each reply gets its per-reply response time.
    let lastInbound = t.createdAt.getTime();
    let matchedSentAt = false;
    for (const m of t.originalMessage.matchAll(MARKER_RE)) {
      const [, kind, ts, agent] = m;
      const at = parseStockholmTimestamp(ts);
      if (!at) continue;
      if (kind === 'Följdmail') {
        events.push({ ...base, type: 'inbound_received', actor: 'backfill', createdAt: at });
        lastInbound = Math.max(lastInbound, at.getTime());
        parsedInbound += 1;
      } else {
        const responseSeconds = Math.max(0, Math.round((at.getTime() - lastInbound) / 1000));
        events.push({
          ...base,
          type: 'reply_sent',
          actor: agent?.trim() || 'backfill',
          responseSeconds,
          createdAt: at,
        });
        parsedReplies += 1;
        if (t.sentAt && Math.abs(at.getTime() - t.sentAt.getTime()) <= 2 * 60 * 1000) {
          matchedSentAt = true;
        }
      }
    }

    // Pre-marker-era tickets: sentAt exists but no marker matched it.
    if (t.sentAt && !matchedSentAt) {
      const responseSeconds = Math.max(0, Math.round((t.sentAt.getTime() - lastInbound) / 1000));
      events.push({
        ...base,
        type: 'reply_sent',
        actor: t.sentBy?.trim() || 'backfill',
        responseSeconds,
        createdAt: t.sentAt,
      });
      sentAtFallbacks += 1;
    }
  }

  console.log(`Tenant: ${TENANT}`);
  console.log(`Tickets scanned: ${tickets.length} (skipped, already backfilled: ${skipped})`);
  console.log(`Events to insert: ${events.length}`);
  console.log(`  reply_sent from markers: ${parsedReplies}`);
  console.log(`  inbound_received from markers: ${parsedInbound}`);
  console.log(`  reply_sent from sentAt fallback: ${sentAtFallbacks}`);

  if (DRY_RUN) {
    console.log('DRY_RUN=1 — nothing written.');
    return;
  }

  const CHUNK = 1000;
  for (let i = 0; i < events.length; i += CHUNK) {
    await prisma.ticketEvent.createMany({ data: events.slice(i, i + CHUNK) });
    console.log(`Inserted ${Math.min(i + CHUNK, events.length)}/${events.length}`);
  }
  console.log('Done.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
