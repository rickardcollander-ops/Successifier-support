import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { AGENTS } from '@/lib/constants';
import { isVendorTicket, isBounceTicket } from '@/lib/ticket-filters';

// Same marker /api/tickets uses to hide imported Zendesk history from the
// inbox. The reports must exclude them too, or the historical import shows
// up as thousands of "new" tickets in every chart.
const ZENDESK_IMPORT_MARKER = '[Zendesk Import Source:';

// Fixed display order for the two breakdown charts. Without this the keys
// come out in "first ticket seen" order, so the priority chart jumped
// around between loads and looked broken.
const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];
const STATUS_ORDER = ['new', 'in_progress', 'waiting_ai', 'review', 'sent', 'closed'];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// All "per day" logic uses calendar days in Europe/Stockholm — the team's
// timezone. The server runs in UTC, so the old `new Date(y, m, d)` bucketing
// anchored days at UTC midnight: tickets arriving 00:00–02:00 Swedish time
// were counted on the previous day and "Lösta idag" reset two hours late.
// sv-SE formatting yields "YYYY-MM-DD", which we use directly as bucket key.
const dayKey = (d: Date) =>
  d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

// Build counts into a stable, ordered object: known keys first in their
// canonical order, anything unexpected appended so it still shows up.
function orderedCounts(values: string[], order: string[]): Record<string, number> {
  const raw: Record<string, number> = {};
  for (const v of values) raw[v] = (raw[v] || 0) + 1;
  const out: Record<string, number> = {};
  for (const key of order) {
    if (raw[key]) out[key] = raw[key];
  }
  for (const key of Object.keys(raw)) {
    if (!(key in out)) out[key] = raw[key];
  }
  return out;
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';

    const tenant = await getTenant();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const now = new Date();
    const isHourly = range === '1d';
    const daysAgo =
      range === '7d' ? 7 :
      range === '30d' ? 30 :
      range === '90d' ? 90 :
      30;

    // The activity buckets define the report window: a ticket belongs to the
    // report iff its bucket key exists in this map. That guarantees
    // totalTickets, the breakdown charts and the activity chart all describe
    // exactly the same set of tickets.
    //
    // "1d" uses 24 hourly buckets ending with the current (partial) hour —
    // a single daily bar tells you nothing. Other ranges use one bucket per
    // Stockholm calendar day.
    const bucketKeys: string[] = [];
    if (isHourly) {
      const currentHourStart = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
      for (let i = 23; i >= 0; i--) {
        bucketKeys.push(new Date(currentHourStart - i * HOUR_MS).toISOString());
      }
    } else {
      for (let i = daysAgo - 1; i >= 0; i--) {
        const key = dayKey(new Date(now.getTime() - i * DAY_MS));
        // Stepping 24h across a DST switch can land on the same Stockholm
        // date twice — skip the duplicate instead of drawing two bars.
        if (bucketKeys[bucketKeys.length - 1] !== key) bucketKeys.push(key);
      }
    }
    const bucketCounts = new Map<string, number>(bucketKeys.map((k) => [k, 0]));
    const bucketKeyFor = (d: Date) =>
      isHourly
        ? new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS).toISOString()
        : dayKey(d);

    // Query with a one-day margin and let bucket membership do the precise
    // (timezone-aware) cut. Zendesk imports are excluded in the query, the
    // folder filters below need subject/sender so they run in JS.
    const queryStart = isHourly
      ? new Date(now.getTime() - DAY_MS)
      : new Date(now.getTime() - (daysAgo + 1) * DAY_MS);

    const rows = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        createdAt: { gte: queryStart },
        NOT: {
          originalMessage: { contains: ZENDESK_IMPORT_MARKER },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Count the same population the inbox tabs show: vendor mail (Billecta),
    // bounces, dubletter and archived tickets live in separate folders and
    // are excluded from the normal counters there — including them here is
    // what made the priority/per-agent numbers look wrong (Billecta alone
    // adds many "normal" tickets per day).
    const isReportable = (t: { status: string; customerEmail: string; subject: string }) =>
      t.status !== 'archived' &&
      t.status !== 'duplicate' &&
      !isVendorTicket(t) &&
      !isBounceTicket(t);

    const tickets = rows.filter(
      (t) => isReportable(t) && bucketCounts.has(bucketKeyFor(t.createdAt))
    );
    for (const t of tickets) {
      const key = bucketKeyFor(t.createdAt);
      bucketCounts.set(key, (bucketCounts.get(key) || 0) + 1);
    }

    const totalTickets = tickets.length;

    const ticketsByStatus = orderedCounts(
      tickets.map((t) => t.status),
      STATUS_ORDER
    );
    const ticketsByPriority = orderedCounts(
      tickets.map((t) => t.priority),
      PRIORITY_ORDER
    );

    // Pending tickets (new or in_progress)
    const pendingTickets = tickets.filter(
      (t) => t.status === 'new' || t.status === 'in_progress'
    ).length;

    // Replies SENT within the window, regardless of when the ticket was
    // created. The old code only looked at tickets created in range, so an
    // answer sent today on a week-old ticket never counted — that's why
    // "skickade" per medarbetare came out far too low on short ranges.
    const sentRows = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        sentAt: { gte: queryStart },
        NOT: {
          originalMessage: { contains: ZENDESK_IMPORT_MARKER },
        },
      },
    });
    const sentInRange = sentRows.filter(
      (t) =>
        t.sentAt &&
        bucketCounts.has(bucketKeyFor(t.sentAt)) &&
        !isVendorTicket(t) &&
        !isBounceTicket(t)
    );

    // Average time from the customer's mail to the agent clicking Send,
    // for replies sent in the window.
    const avgResponseTime = sentInRange.length > 0
      ? sentInRange.reduce((sum, ticket) => {
          const created = ticket.createdAt.getTime();
          const sent = ticket.sentAt!.getTime();
          return sum + (sent - created) / HOUR_MS;
        }, 0) / sentInRange.length
      : 0;

    // Resolved today — a "today" metric independent of the selected range:
    // a ticket opened last week but closed this morning still counts.
    // "Today" means the current Stockholm calendar day.
    const todayKey = dayKey(now);
    const resolvedTodayRows = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        status: { in: ['sent', 'closed'] },
        updatedAt: { gte: new Date(now.getTime() - 2 * DAY_MS) },
        NOT: {
          originalMessage: { contains: ZENDESK_IMPORT_MARKER },
        },
      },
      select: { customerEmail: true, subject: true, updatedAt: true },
    });
    const resolvedToday = resolvedTodayRows.filter(
      (t) =>
        dayKey(t.updatedAt) === todayKey &&
        !isVendorTicket(t) &&
        !isBounceTicket(t)
    ).length;

    const recentActivity = bucketKeys.map((key) => ({
      date: key,
      count: bucketCounts.get(key) || 0,
    }));

    // Per-user statistics: tickets assigned to each agent (created in range)
    // and replies they sent in range. Known agents always appear, even at 0;
    // unknown names seen in the data get their own row so nothing is hidden.
    type AgentStats = { name: string; assigned: number; sent: number };
    const perUserMap = new Map<string, AgentStats>();
    for (const agent of AGENTS) {
      perUserMap.set(agent, { name: agent, assigned: 0, sent: 0 });
    }
    // sentBy is stored as session.user.name OR session.user.email, so
    // Malin sometimes gets logged as "Malin Sundberg" and sometimes as
    // "malin@doldadress.se". Resolve both forms back to the canonical
    // agent name. Matching is on whole name/email tokens — a plain
    // substring test wrongly credited e.g. "frida@…" to Ida.
    const resolveAgent = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      if (perUserMap.has(raw)) return raw;
      const lower = raw.toLowerCase();
      const tokens = lower.split(/[^a-zåäöé]+/).filter(Boolean);
      for (const agent of AGENTS) {
        if (agent.toLowerCase() === lower) return agent;
        const first = agent.split(' ')[0].toLowerCase();
        if (tokens.includes(first)) return agent;
      }
      return raw;
    };
    const bump = (raw: string, field: 'assigned' | 'sent') => {
      const name = resolveAgent(raw) || raw;
      const existing = perUserMap.get(name) || { name, assigned: 0, sent: 0 };
      existing[field] += 1;
      perUserMap.set(name, existing);
    };
    for (const t of tickets) {
      if (t.assignedTo) bump(t.assignedTo, 'assigned');
    }
    for (const t of sentInRange) {
      if (t.sentBy) bump(t.sentBy, 'sent');
    }
    const perUserStats = Array.from(perUserMap.values())
      // Sort by sent desc, then assigned desc, then name as tiebreak
      .sort((a, b) => b.sent - a.sent || b.assigned - a.assigned || a.name.localeCompare(b.name));

    return NextResponse.json({
      totalTickets,
      ticketsByStatus,
      ticketsByPriority,
      avgResponseTime: Math.round(avgResponseTime * 10) / 10, // Round to 1 decimal
      resolvedToday,
      pendingTickets,
      recentActivity,
      // Tells the client how to label the activity bars ("14:00" vs "3 jun").
      activityInterval: isHourly ? 'hour' : 'day',
      perUserStats,
    });
  } catch (error) {
    console.error('Error fetching report data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch report data' },
      { status: 500 }
    );
  }
}
