import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { getAgents, stripAgentSignature } from '@/lib/constants';
import { isVendorTicket, isBounceTicket, isReportable } from '@/lib/ticket-filters';
import { resolveAgentName } from '@/lib/agent-match';
import { keptFromDraftRatio } from '@/lib/text-diff';
import {
  HOUR_MS,
  DAY_MS,
  dayKey,
  stockholmMidnight,
  shiftDayKey,
  stockholmSlot,
} from '@/lib/time/stockholm';
import { resolveReportWindow, type ReportWindow } from '@/lib/report-window';
import { TICKET_EVENT } from '@/lib/services/ticket-events';
import { parseBusinessHours, businessHoursBetween, type BusinessHours } from '@/lib/business-hours';

// The full report computation, extracted from app/api/reports/route.ts so it
// can be called from more than one place: the reports API route, the
// previous-period comparison below, and scheduled digests. The route is a
// thin auth + params wrapper around computeReportData.

// Same marker /api/tickets uses to hide imported Zendesk history from the
// inbox. The reports must exclude them too, or the historical import shows
// up as thousands of "new" tickets in every chart.
export const ZENDESK_IMPORT_MARKER = '[Zendesk Import Source:';

// Fixed display order for the two breakdown charts. Without this the keys
// come out in "first ticket seen" order, so the priority chart jumped
// around between loads and looked broken.
export const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];
export const STATUS_ORDER = ['new', 'in_progress', 'waiting_ai', 'review', 'sent', 'closed'];

// Statuses that count as "open" for backlog and SLA follow-up.
export const OPEN_STATUSES = ['new', 'in_progress', 'waiting_ai', 'review'];
// Statuses that close a ticket for backlog purposes.
export const TERMINAL_STATUSES = ['sent', 'closed', 'archived', 'duplicate'];

// Below this many tickets in a group we don't make comparative claims — a
// rate or delta off a handful of tickets is noise, not a result. Mirrors
// MIN_GROUP on the reports page.
export const MIN_RATE_SAMPLE = 15;

// CSAT responses trickle in slowly (a click per emailed reply at best), so
// the floor for claiming a satisfaction percentage is lower than for the
// volume-based rates — but there is still a floor.
export const MIN_CSAT_SAMPLE = 10;

// Window resolution lives in lib/report-window.ts (shared with the
// drill-down endpoints so every report view slices time identically); the
// underlying Stockholm calendar helpers in lib/time/stockholm.ts.

// Build counts into a stable, ordered object: known keys first in their
// canonical order, anything unexpected appended so it still shows up.
export function orderedCounts(values: string[], order: string[]): Record<string, number> {
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

// Median is the headline number for time-to-X: a couple of tickets left open
// over a weekend skew the mean badly, and "half our tickets are answered
// faster than X" is the claim that actually survives scrutiny.
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// p90 sits next to the median to show the tail — "even the slow ones are
// under X". Nearest-rank, which is plenty for a dashboard.
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

// The period a report window is compared against ("vs föregående period").
// "Current" ranges that end at now (1d, rolling Nd, thisWeek, thisMonth)
// compare against the SAME ELAPSED PORTION of the previous period — Tuesday
// morning of this week compares against up to Tuesday morning of last week,
// not the whole of it. Completed ranges (lastWeek, lastMonth, custom) compare
// against the full period immediately before.
export function previousReportWindow(
  range: string,
  win: ReportWindow,
  now: Date = new Date()
): { windowStart: Date; windowEnd: Date } {
  const { windowStart, windowEnd } = win;
  const elapsedMs = windowEnd.getTime() - windowStart.getTime();
  const startKey = dayKey(windowStart);
  const [y, m] = startKey.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');

  if (range === '1d') {
    // The 24h before the current rolling 24h.
    return { windowStart: new Date(windowStart.getTime() - DAY_MS), windowEnd: windowStart };
  }
  if (range === 'thisMonth' || range === 'lastMonth') {
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const prevStart = stockholmMidnight(`${prevY}-${pad(prevM)}-01`);
    if (range === 'lastMonth') {
      return { windowStart: prevStart, windowEnd: windowStart };
    }
    // Same elapsed portion of the previous month, clamped for months of
    // different length (31 days elapsed can't fit in February).
    const prevEnd = new Date(Math.min(prevStart.getTime() + elapsedMs, windowStart.getTime()));
    return { windowStart: prevStart, windowEnd: prevEnd };
  }

  // Day-based ranges: shift back by the window's span in calendar days.
  const spanDays =
    range === '7d' || range === 'thisWeek' || range === 'lastWeek' ? 7
    : range === '30d' ? 30
    : range === '90d' ? 90
    : Math.round((stockholmMidnight(dayKey(new Date(windowEnd.getTime() - 1))).getTime() -
        windowStart.getTime()) / DAY_MS) + 1;
  const prevStart = stockholmMidnight(shiftDayKey(startKey, -spanDays));
  const completed = range === 'lastWeek' || range === 'custom' || windowEnd.getTime() < now.getTime();
  const prevEnd = completed
    ? windowStart
    : new Date(Math.min(prevStart.getTime() + elapsedMs, windowStart.getTime()));
  return { windowStart: prevStart, windowEnd: prevEnd };
}

export interface ReportFilters {
  agent: string | null;
  status: string | null;
  priority: string | null;
  category: string | null;
}

// Validate raw filter params against the known value sets so a typo'd URL
// degrades to "no filter" instead of an empty report. The agent filter
// accepts anything resolveAgentName maps to a known agent; the category
// filter accepts the product's category list plus 'uncategorized'.
export function validateFilters(raw: {
  agent?: string | null;
  status?: string | null;
  priority?: string | null;
  category?: string | null;
}): ReportFilters {
  const categories = product.ticketCategories ?? [];
  return {
    agent: resolveAgentName(raw.agent ?? null),
    status: raw.status && STATUS_ORDER.includes(raw.status) ? raw.status : null,
    priority: raw.priority && PRIORITY_ORDER.includes(raw.priority) ? raw.priority : null,
    category:
      raw.category && (categories.includes(raw.category) || raw.category === 'uncategorized')
        ? raw.category
        : null,
  };
}

// Matches a ticket against the category filter. 'uncategorized' selects the
// tickets that have no category (yet) — they must stay reachable, not hidden.
export function matchesCategory(
  ticketCategory: string | null | undefined,
  filter: string | null
): boolean {
  if (!filter) return true;
  if (filter === 'uncategorized') return ticketCategory == null;
  return ticketCategory === filter;
}

// The "what do customers ask about" breakdown: ticket counts per category
// (created population) with first-response medians from the sent population.
// Pure — exported for unit tests. Uncategorised tickets get their own row
// (category: null) so nothing is hidden.
export function categoryStats(
  created: Array<{ category: string | null }>,
  sent: Array<{ category: string | null; createdAt: Date; sentAt: Date | null }>
): Array<{ category: string | null; count: number; responseCount: number; responseMedianHours: number }> {
  const rows = new Map<
    string | null,
    { count: number; responseHoursList: number[] }
  >();
  const bucket = (key: string | null) => {
    let entry = rows.get(key);
    if (!entry) {
      entry = { count: 0, responseHoursList: [] };
      rows.set(key, entry);
    }
    return entry;
  };
  for (const t of created) bucket(t.category ?? null).count += 1;
  for (const t of sent) {
    if (!t.sentAt) continue;
    bucket(t.category ?? null).responseHoursList.push(
      (t.sentAt.getTime() - t.createdAt.getTime()) / HOUR_MS
    );
  }
  return Array.from(rows.entries())
    .map(([category, r]) => ({
      category,
      count: r.count,
      responseCount: r.responseHoursList.length,
      responseMedianHours: Math.round(median(r.responseHoursList) * 10) / 10,
    }))
    // Biggest first; the uncategorised row always last so the real
    // categories lead the chart.
    .sort((a, b) =>
      (a.category === null ? 1 : 0) - (b.category === null ? 1 : 0) ||
      b.count - a.count ||
      String(a.category).localeCompare(String(b.category))
    );
}

// Open, still-unanswered tickets that have already passed the first-response
// threshold — the ones an agent should grab next. Shared by the SLA panel
// and the SLA alert cron so both always list the same tickets. When
// öppettider are configured the threshold counts elapsed OPEN hours.
//
// The createdAt cutoff in SQL is intentionally CALENDAR-based even when
// öppettider are configured: open hours elapsed <= calendar hours elapsed,
// always, so the SQL filter is a correct SUPERSET prefilter — a ticket
// cannot be overdue in open hours without being at least that old in
// calendar time. The precise business-hours test runs in JS below. Do not
// "fix" this filter to use business hours.
export async function findOverdueUnanswered(
  tenantId: string,
  thresholdHours: number,
  now: Date = new Date(),
  businessHours: BusinessHours | null = null
): Promise<Array<{ id: string; subject: string; status: string; createdAt: Date }>> {
  const openRows = await prisma.ticket.findMany({
    where: {
      tenantId,
      status: { in: OPEN_STATUSES },
      createdAt: { lte: new Date(now.getTime() - thresholdHours * HOUR_MS) },
      NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
    },
    select: { id: true, subject: true, status: true, createdAt: true, customerEmail: true },
    orderBy: { createdAt: 'asc' },
  });
  const openReportable = openRows.filter((t) => !isVendorTicket(t) && !isBounceTicket(t));
  const openIds = openReportable.map((t) => t.id);
  const openWithReply = openIds.length > 0
    ? await prisma.ticketEvent.findMany({
        where: { ticketId: { in: openIds }, type: TICKET_EVENT.replySent },
        select: { ticketId: true },
        distinct: ['ticketId'],
      })
    : [];
  const repliedSet = new Set(openWithReply.map((e) => e.ticketId));
  return openReportable
    .filter(
      (t) =>
        !repliedSet.has(t.id) &&
        (!businessHours || businessHoursBetween(businessHours, t.createdAt, now) > thresholdHours)
    )
    .map(({ id, subject, status, createdAt }) => ({ id, subject, status, createdAt }));
}

// The light KPI subset, computed over an arbitrary window. Used for the
// previous-period comparison and for scheduled digests — the definitions
// deliberately mirror computeReportData's (same populations, same
// exclusions) so a delta always compares like with like.
export interface KpiSummary {
  from: string;
  to: string;
  totalTickets: number;
  totalSent: number;
  medianResponseHours: number;
  firstResponse: { count: number; medianHours: number; p90Hours: number };
  activeWork: { count: number; medianMinutes: number };
  editStats: { count: number; medianKeptPct: number };
  sla: { targetHours: number; answered: number; met: number; attainmentPct: number | null } | null;
  // Top 3 categorised topics in the window, for the digest.
  topCategories: Array<{ category: string; count: number }>;
  // One-click customer satisfaction: sharePct null below MIN_CSAT_SAMPLE.
  csat: { count: number; positive: number; sharePct: number | null };
}

export async function computeKpiSummary(
  tenantId: string,
  windowStart: Date,
  windowEnd: Date,
  filters: ReportFilters = { agent: null, status: null, priority: null, category: null },
  slaTargetHours: number | null = null,
  // Öppettider: when set, firstResponse and SLA count elapsed OPEN hours —
  // must match the basis computeReportData uses or deltas compare apples
  // with oranges.
  businessHours: BusinessHours | null = null
): Promise<KpiSummary> {
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
  const comparableBody = (s: string | null | undefined) =>
    stripAgentSignature((s ?? '').split('[INLINE_IMAGES]')[0]);

  const [createdRows, sentRows, feedbackRows, replyEvents, csatRows] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        tenantId,
        createdAt: { gte: windowStart, lt: windowEnd },
        NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
      },
      select: { id: true, status: true, priority: true, customerEmail: true, subject: true, assignedTo: true, category: true, createdAt: true },
    }),
    prisma.ticket.findMany({
      where: {
        tenantId,
        sentAt: { gte: windowStart, lt: windowEnd },
        NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
      },
      select: {
        id: true, status: true, customerEmail: true, subject: true, sentBy: true,
        category: true, sentAt: true, createdAt: true, activeWorkSeconds: true,
        aiResponse: true, finalResponse: true,
      },
    }),
    prisma.aIResponseFeedback.findMany({
      where: { tenantId, createdAt: { gte: windowStart, lt: windowEnd } },
      select: { ticketId: true, wasEdited: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.ticketEvent.findMany({
      where: {
        tenantId,
        type: TICKET_EVENT.replySent,
        createdAt: { gte: windowStart, lt: windowEnd },
      },
      select: {
        ticketId: true,
        createdAt: true,
        actor: true,
        ticket: { select: { createdAt: true, customerEmail: true, subject: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.csatResponse.findMany({
      where: { tenantId, createdAt: { gte: windowStart, lt: windowEnd } },
      select: { rating: true },
    }),
  ]);

  const csatPositive = csatRows.filter((r) => r.rating === 'positive').length;
  const csat = {
    count: csatRows.length,
    positive: csatPositive,
    sharePct:
      csatRows.length >= MIN_CSAT_SAMPLE
        ? Math.round((csatPositive / csatRows.length) * 100)
        : null,
  };

  const reportableCreated = createdRows.filter((t) => isReportable(t));
  const filteredCreated = reportableCreated.filter(
    (t) =>
      (!filters.status || t.status === filters.status) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!filters.agent || resolveAgentName(t.assignedTo) === filters.agent) &&
      matchesCategory(t.category, filters.category)
  );
  const totalTickets = filteredCreated.length;

  const sentInRange = sentRows.filter(
    (t) =>
      t.sentAt &&
      !isVendorTicket(t) &&
      !isBounceTicket(t) &&
      (!filters.agent || resolveAgentName(t.sentBy) === filters.agent) &&
      matchesCategory(t.category, filters.category)
  );

  // Top topics for the digest — categorised tickets only, biggest first.
  const catCounts = new Map<string, number>();
  for (const t of filteredCreated) {
    if (t.category) catCounts.set(t.category, (catCounts.get(t.category) || 0) + 1);
  }
  const topCategories = Array.from(catCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .slice(0, 3);
  const medianResponseHours = median(
    sentInRange.map((t) => (t.sentAt!.getTime() - t.createdAt.getTime()) / HOUR_MS)
  );

  const activeSeconds = sentInRange.map((t) => t.activeWorkSeconds ?? 0).filter((s) => s > 0);
  const activeWork = {
    count: activeSeconds.length,
    medianMinutes: activeSeconds.length > 0 ? Math.round((median(activeSeconds) / 60) * 10) / 10 : 0,
  };

  // AI contribution over the same sent population as the main report: how
  // much of each sent reply came from the AI draft (word overlap).
  const editedByTicket = new Map<string, boolean>();
  for (const f of feedbackRows) editedByTicket.set(f.ticketId, f.wasEdited); // last write wins
  const keptRatios: number[] = [];
  for (const t of sentInRange) {
    const fb = editedByTicket.get(t.id);
    const hasDraft = norm(comparableBody(t.aiResponse)) !== '';
    if (!hasDraft && fb === undefined) continue;
    const kept = fb === false
      ? 1
      : keptFromDraftRatio(comparableBody(t.aiResponse), comparableBody(t.finalResponse));
    if (kept == null) continue;
    keptRatios.push(kept);
  }
  const editStats = {
    count: keptRatios.length,
    medianKeptPct: keptRatios.length > 0 ? Math.round(median(keptRatios) * 100) : 0,
  };

  // First reply per ticket within the window; tickets that already had a
  // reply BEFORE the window are not "first responses" and are excluded.
  const reportableReplies = replyEvents.filter(
    (e) => isReportable(e.ticket) && (!filters.agent || e.actor === filters.agent)
  );
  const repliesByTicket = new Map<string, { first: Date; ticketCreatedAt: Date }>();
  for (const e of reportableReplies) {
    if (!repliesByTicket.has(e.ticketId)) {
      repliesByTicket.set(e.ticketId, { first: e.createdAt, ticketCreatedAt: e.ticket.createdAt });
    }
  }
  const replyTicketIds = Array.from(repliesByTicket.keys());
  const earlierReplies = replyTicketIds.length > 0
    ? await prisma.ticketEvent.findMany({
        where: {
          ticketId: { in: replyTicketIds },
          type: TICKET_EVENT.replySent,
          createdAt: { lt: windowStart },
        },
        select: { ticketId: true },
        distinct: ['ticketId'],
      })
    : [];
  const hadEarlierReply = new Set(earlierReplies.map((e) => e.ticketId));
  // Primary figure follows the configured basis (open hours when öppettider
  // are set, calendar otherwise) — same as computeReportData.
  const firstPairs = Array.from(repliesByTicket.entries())
    .filter(([id]) => !hadEarlierReply.has(id))
    .map(([, v]) => v)
    .filter((v) => v.first.getTime() >= v.ticketCreatedAt.getTime());
  const firstResponseHoursList = firstPairs.map((v) =>
    businessHours
      ? businessHoursBetween(businessHours, v.ticketCreatedAt, v.first)
      : (v.first.getTime() - v.ticketCreatedAt.getTime()) / HOUR_MS
  );
  const firstResponse = {
    count: firstResponseHoursList.length,
    medianHours: Math.round(median(firstResponseHoursList) * 10) / 10,
    p90Hours: Math.round(percentile(firstResponseHoursList, 90) * 10) / 10,
  };

  // SLA attainment over the UNFILTERED reportable created population, same
  // as the main report's team-level SLA panel.
  let sla: KpiSummary['sla'] = null;
  if (slaTargetHours != null) {
    const createdIds = reportableCreated.map((t) => t.id);
    const firstReplies = createdIds.length > 0
      ? await prisma.ticketEvent.groupBy({
          by: ['ticketId'],
          where: { ticketId: { in: createdIds }, type: TICKET_EVENT.replySent },
          _min: { createdAt: true },
        })
      : [];
    const firstReplyAt = new Map<string, Date>();
    for (const r of firstReplies) {
      if (r._min.createdAt) firstReplyAt.set(r.ticketId, r._min.createdAt);
    }
    let answered = 0;
    let met = 0;
    for (const t of reportableCreated) {
      const fr = firstReplyAt.get(t.id);
      if (!fr) continue;
      answered += 1;
      const elapsed = businessHours
        ? businessHoursBetween(businessHours, t.createdAt, fr)
        : (fr.getTime() - t.createdAt.getTime()) / HOUR_MS;
      if (elapsed <= slaTargetHours) met += 1;
    }
    sla = {
      targetHours: slaTargetHours,
      answered,
      met,
      attainmentPct: answered > 0 ? Math.round((met / answered) * 100) : null,
    };
  }

  return {
    from: windowStart.toISOString(),
    to: windowEnd.toISOString(),
    totalTickets,
    totalSent: sentInRange.length,
    medianResponseHours: Math.round(medianResponseHours * 10) / 10,
    firstResponse,
    activeWork,
    editStats,
    sla,
    topCategories,
    csat,
  };
}

export interface ReportQuery {
  range: string;
  from?: string | null;
  to?: string | null;
  agent?: string | null;
  status?: string | null;
  priority?: string | null;
  category?: string | null;
}

// The full report payload — everything the /reports page renders. Exactly the
// computation that used to live inline in app/api/reports/route.ts.
export async function computeReportData(
  tenantId: string,
  query: ReportQuery,
  now: Date = new Date()
) {
  const range = query.range || '30d';
  const {
    agent: agentFilter,
    status: statusFilter,
    priority: priorityFilter,
    category: categoryFilter,
  } = validateFilters(query);

  // Resolve the report window [windowStart, windowEnd). Everything
  // downstream (buckets, filtering, trend) derives from this window, so all
  // panels describe exactly the same set of tickets.
  const { windowStart, windowEnd, isHourly } = resolveReportWindow(
    range,
    query.from ?? null,
    query.to ?? null,
    now
  );

  // The activity buckets define the report window: a ticket belongs to the
  // report iff its bucket key exists in this map. That guarantees
  // totalTickets, the breakdown charts and the activity chart all describe
  // exactly the same set of tickets.
  //
  // "1d" uses 24 hourly buckets ending with the current (partial) hour —
  // a single daily bar tells you nothing. Other ranges use one bucket per
  // Stockholm calendar day the window covers.
  const bucketKeys: string[] = [];
  if (isHourly) {
    const currentHourStart = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
    for (let i = 23; i >= 0; i--) {
      bucketKeys.push(new Date(currentHourStart - i * HOUR_MS).toISOString());
    }
  } else {
    // windowEnd is exclusive (midnight) for the past calendar ranges and
    // `now` for the current/rolling ones — either way, the last included day
    // is the one covering the instant just before windowEnd.
    const lastDay = dayKey(new Date(windowEnd.getTime() - 1));
    let key = dayKey(windowStart);
    for (let guard = 0; guard < 400; guard++) {
      bucketKeys.push(key);
      if (key === lastDay) break;
      key = shiftDayKey(key, 1);
    }
  }
  const bucketCounts = new Map<string, number>(bucketKeys.map((k) => [k, 0]));
  const bucketKeyFor = (d: Date) =>
    isHourly
      ? new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS).toISOString()
      : dayKey(d);

  // Query with a one-day margin on each side and let bucket membership do the
  // precise (timezone-aware) cut. Zendesk imports are excluded in the query;
  // the folder filters below need subject/sender so they run in JS.
  const queryStart = new Date(windowStart.getTime() - DAY_MS);
  const queryEnd = new Date(windowEnd.getTime() + DAY_MS);

  // Explicit select: originalMessage (whole email threads) and contextData
  // are by far the heaviest columns and none of the report math needs them
  // — the Zendesk exclusion already runs SQL-side. aiResponse/finalResponse
  // stay: the AI-contribution diff reads them.
  const reportSelect = {
    id: true,
    status: true,
    priority: true,
    customerEmail: true,
    subject: true,
    assignedTo: true,
    sentBy: true,
    category: true,
    sentAt: true,
    createdAt: true,
    workStartedAt: true,
    activeWorkSeconds: true,
    aiResponse: true,
    finalResponse: true,
  } as const;

  // The six window-level queries are independent of each other — run them
  // concurrently instead of as a waterfall.
  const [rows, sentRows, feedbackRows, reportSettings, resolvedTodayRows, replyEvents, csatRows] =
    await Promise.all([
      prisma.ticket.findMany({
        where: {
          tenantId,
          createdAt: { gte: queryStart, lte: queryEnd },
          NOT: {
            originalMessage: { contains: ZENDESK_IMPORT_MARKER },
          },
        },
        select: reportSelect,
        orderBy: { createdAt: 'asc' },
      }),
      // Replies SENT within the window, regardless of when the ticket was
      // created. The old code only looked at tickets created in range, so an
      // answer sent today on a week-old ticket never counted — that's why
      // "skickade" per medarbetare came out far too low on short ranges.
      prisma.ticket.findMany({
        where: {
          tenantId,
          sentAt: { gte: queryStart, lte: queryEnd },
          NOT: {
            originalMessage: { contains: ZENDESK_IMPORT_MARKER },
          },
        },
        select: reportSelect,
      }),
      // With vs without AI — the causal part of the case. wasEdited from the
      // AIResponseFeedback log is authoritative when present; otherwise we
      // infer from the ticket itself (no aiResponse = no AI; finalResponse
      // equal to aiResponse = sent as-is; otherwise rewritten).
      prisma.aIResponseFeedback.findMany({
        where: { tenantId, createdAt: { gte: queryStart, lte: queryEnd } },
        select: { ticketId: true, wasEdited: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.reportSettings.findUnique({
        where: { tenantId },
      }),
      // Resolved today — a "today" metric independent of the selected range:
      // a ticket opened last week but closed this morning still counts.
      // "Today" means the current Stockholm calendar day.
      prisma.ticket.findMany({
        where: {
          tenantId,
          status: { in: ['sent', 'closed'] },
          updatedAt: { gte: new Date(now.getTime() - 2 * DAY_MS) },
          NOT: {
            originalMessage: { contains: ZENDESK_IMPORT_MARKER },
          },
        },
        select: { customerEmail: true, subject: true, updatedAt: true },
      }),
      // ── Reply events in window: first response + replies per ticket ─────
      // The event log records EVERY reply (the Ticket's sentAt is overwritten
      // by the next one), which is what makes these metrics possible at all.
      // Population filtering joins the Ticket so vendor/bounce/archived rules
      // match the rest of the report. Zendesk imports never get events.
      prisma.ticketEvent.findMany({
        where: {
          tenantId,
          type: TICKET_EVENT.replySent,
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        select: {
          ticketId: true,
          createdAt: true,
          actor: true,
          ticket: {
            select: { createdAt: true, customerEmail: true, subject: true, status: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      // One-click CSAT ratings received in the window (newest first — the
      // negative drill-down shows the latest cases).
      prisma.csatResponse.findMany({
        where: { tenantId, createdAt: { gte: windowStart, lte: windowEnd } },
        select: {
          ticketId: true,
          rating: true,
          comment: true,
          createdAt: true,
          ticket: { select: { subject: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

  // Öppettider: when configured, firstResponse and sla below count
  // elapsed OPEN hours instead of calendar hours (calendar kept as a
  // secondary figure). Null = calendar semantics, exactly as before.
  // NOTE: medianResponseTime/avgResponseTime deliberately STAY calendar —
  // their ROI baseline (baselineResponseHours) was measured in calendar
  // time in the Zendesk era, so changing their basis would silently break
  // that comparison.
  const businessHours = parseBusinessHours(reportSettings?.businessHours ?? null);

  // The same population the inbox tabs show (isReportable — vendor mail,
  // bounces, dubletter and archived excluded), before user filters. SLA
  // and backlog are computed from this team-level population so they stay
  // the truth regardless of active filters.
  const reportableTickets = rows.filter(
    (t) => isReportable(t) && bucketCounts.has(bucketKeyFor(t.createdAt))
  );

  // User filters applied on top (in JS, not SQL — SLA/backlog need the
  // unfiltered population). The agent filter matches the assignee.
  const tickets = reportableTickets.filter(
    (t) =>
      (!statusFilter || t.status === statusFilter) &&
      (!priorityFilter || t.priority === priorityFilter) &&
      (!agentFilter || resolveAgentName(t.assignedTo) === agentFilter) &&
      matchesCategory(t.category, categoryFilter)
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

  const sentInRange = sentRows.filter(
    (t) =>
      t.sentAt &&
      bucketCounts.has(bucketKeyFor(t.sentAt)) &&
      !isVendorTicket(t) &&
      !isBounceTicket(t) &&
      // The agent filter follows who SENT the reply here (assignee on the
      // created population above) — that's the natural reading for
      // response/handling metrics.
      (!agentFilter || resolveAgentName(t.sentBy) === agentFilter) &&
      matchesCategory(t.category, categoryFilter)
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

  // Average active handling time: how long an agent actually worked on a
  // ticket, measured from when work started (workStartedAt — set the first
  // time the ticket left "new" or got assigned) to when the reply was sent.
  // Unlike avgResponseTime this excludes the time the ticket sat untouched
  // in the queue, so it reflects effort per ticket — the proof-of-concept
  // metric for the tool. Tickets sent without ever being marked as worked
  // (no workStartedAt) are excluded rather than counted as zero.
  const handledInRange = sentInRange.filter(
    (t) => t.workStartedAt && t.sentAt && t.sentAt.getTime() > t.workStartedAt.getTime()
  );
  const avgHandlingTime = handledInRange.length > 0
    ? handledInRange.reduce((sum, ticket) => {
        const started = ticket.workStartedAt!.getTime();
        const sent = ticket.sentAt!.getTime();
        return sum + (sent - started) / 60000; // minutes
      }, 0) / handledInRange.length
    : 0;

  // ── Value case: trend, with-vs-without AI, and money saved ───────────
  // Per-ticket time getters reused below. Response = wall-clock from the
  // customer's mail to Send (hours). Handling = active work time from
  // workStartedAt to Send (minutes), only where we actually have a start.
  const responseHours = (t: { createdAt: Date; sentAt: Date | null }) =>
    (t.sentAt!.getTime() - t.createdAt.getTime()) / HOUR_MS;
  const hasHandling = (t: { workStartedAt: Date | null; sentAt: Date | null }) =>
    Boolean(t.workStartedAt && t.sentAt && t.sentAt.getTime() > t.workStartedAt.getTime());
  const handlingMinutes = (t: { workStartedAt: Date | null; sentAt: Date | null }) =>
    (t.sentAt!.getTime() - t.workStartedAt!.getTime()) / 60000;

  // Active work time (minutes) from accumulated presence — the real "time
  // inside the ticket", independent of how long it queued. This is the
  // headline effort metric; workStartedAt→sentAt (above) is kept only for the
  // legacy handling figure and is no longer shown as effort.
  const hasActiveWork = (t: { activeWorkSeconds: number | null }) => (t.activeWorkSeconds ?? 0) > 0;
  const activeWorkMinutes = (t: { activeWorkSeconds: number | null }) => (t.activeWorkSeconds ?? 0) / 60;

  // Median response time is the headline (the mean is dragged up by tickets
  // left over a weekend); avgResponseTime is kept only as a secondary figure.
  const medianResponseTime = sentInRange.length > 0 ? median(sentInRange.map(responseHours)) : 0;

  // Summarise a group of sent tickets for the dashboard: median is the
  // headline, p90 shows the tail, handledCount tells the UI how solid the
  // handling number is (a median of 1 ticket isn't a claim).
  const groupStats = (items: typeof sentInRange) => {
    const resp = items.map(responseHours);
    const hand = items.filter(hasHandling).map(handlingMinutes);
    return {
      count: items.length,
      responseMedian: Math.round(median(resp) * 10) / 10,
      handlingMedian: Math.round(median(hand)),
      handlingP90: Math.round(percentile(hand, 90)),
      handledCount: hand.length,
    };
  };

  // Trend over time: is the team getting faster as the knowledge base and
  // AI mature? Weekly buckets for 30/90d, daily for 7d. A single day (1d)
  // can't show a trend, so we skip it. The downward slope IS the argument.
  const trend: Array<{ label: string; responseMedian: number; handlingMedian: number; count: number }> = [];
  const spanDays = Math.max(1, Math.round((windowEnd.getTime() - windowStart.getTime()) / DAY_MS));
  if (!isHourly && spanDays > 1) {
    // Daily steps for short windows (≤ 2 weeks), weekly for longer ones, so
    // the chart never turns into a wall of thin bars.
    const stepDays = spanDays <= 14 ? 1 : 7;
    const stepMs = stepDays * DAY_MS;
    const buckets = Math.ceil(spanDays / stepDays);
    const fmt = (d: Date) =>
      d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm', month: 'short', day: 'numeric' });
    for (let i = 0; i < buckets; i++) {
      const start = windowStart.getTime() + i * stepMs;
      const end = Math.min(start + stepMs, windowEnd.getTime());
      const inBucket = sentInRange.filter((t) => {
        const s = t.sentAt!.getTime();
        return s >= start && s < end;
      });
      const resp = inBucket.map(responseHours);
      const active = inBucket.filter(hasActiveWork).map(activeWorkMinutes);
      trend.push({
        label: fmt(new Date(start)),
        responseMedian: Math.round(median(resp) * 10) / 10,
        // Active work minutes (presence-based) — not workStartedAt→sentAt,
        // which is dominated by queue time and produced absurd hour-long bars.
        handlingMedian: Math.round(median(active) * 10) / 10,
        count: inBucket.length,
      });
    }
  }

  const editedByTicket = new Map<string, boolean>();
  for (const f of feedbackRows) editedByTicket.set(f.ticketId, f.wasEdited); // last write wins

  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
  // Reduce a stored reply to the part that can be fairly compared with the AI
  // draft: drop the inline-image HTML tail (everything after [INLINE_IMAGES] —
  // raw <img>/data-URL markup the draft never contained, which otherwise reads
  // as a wall of inserted "words"), then strip the auto-appended signature.
  const comparableBody = (s: string | null | undefined) =>
    stripAgentSignature((s ?? '').split('[INLINE_IMAGES]')[0]);
  // ONE classification, shared by both the distribution panel and the
  // response-time comparison, so their ticket counts always reconcile. Per
  // sent reply we measure how much of what we sent came from the AI draft
  // (word overlap — condensing is not penalised) and bucket by NEW content
  // (1 − kept): <10% = sent ~as the draft, 10–50% = built on it, ≥50% =
  // mostly agent-written. Replies with no draft are the "utan AI" baseline.
  // The authoritative wasEdited=false flag pins a reply to "from the AI"
  // regardless of incidental character diffs.
  const fromAi: typeof sentInRange = [];
  const builtOn: typeof sentInRange = [];
  const mostlyNew: typeof sentInRange = [];
  const noAi: typeof sentInRange = [];
  const keptRatios: number[] = [];
  for (const t of sentInRange) {
    const fb = editedByTicket.get(t.id);
    const hasDraft = norm(comparableBody(t.aiResponse)) !== '';
    if (!hasDraft && fb === undefined) { noAi.push(t); continue; }
    const kept = fb === false
      ? 1
      : keptFromDraftRatio(comparableBody(t.aiResponse), comparableBody(t.finalResponse));
    if (kept == null) { noAi.push(t); continue; }
    keptRatios.push(kept);
    const newContent = 1 - kept;
    if (newContent < 0.1) fromAi.push(t);
    else if (newContent < 0.5) builtOn.push(t);
    else mostlyNew.push(t);
  }
  const aiComparison = {
    fromAi: groupStats(fromAi),
    builtOn: groupStats(builtOn),
    mostlyNew: groupStats(mostlyNew),
    none: groupStats(noAi),
  };
  const medianKeptPct = keptRatios.length > 0 ? Math.round(median(keptRatios) * 100) : 0;
  const editStats = {
    count: keptRatios.length,
    // "Changed" is the inverse of the kept share — how much of the sent reply
    // the agent wrote that wasn't in the draft.
    medianChangedPct: 100 - medianKeptPct,
    medianKeptPct,
    unchanged: fromAi.length,
    light: builtOn.length,
    heavy: mostlyNew.length,
  };

  // Money saved = time the AI shaved off each ticket × tickets × agent cost.
  // Baseline: a configured "before our tool" handling time wins; otherwise
  // fall back to how long this same team takes WITHOUT an AI draft (the
  // no-AI group), but only when that group is big enough to mean something.
  //
  // "Time now" is the REAL active work time (presence) — the same few-minute
  // figure shown elsewhere, NOT the queue-inclusive workStartedAt→sentAt span
  // that produced absurd hours. The baseline is the team's configured
  // "before our tool" minutes per ticket; we only fall back to the in-app
  // no-AI group when it's big enough (≥15) to mean something, otherwise we
  // leave it null so the UI asks for a baseline instead of inventing one.
  const MIN_BASELINE_SAMPLE = 15;
  const MIN_ACTIVE_SAMPLE = 10;
  const activeNowList = sentInRange.filter(hasActiveWork).map(activeWorkMinutes);
  const activeNowMedian = median(activeNowList);

  let baselineHandlingMinutes: number | null = reportSettings?.baselineHandlingMinutes ?? null;
  let baselineSource: 'configured' | 'no_ai_group' | null =
    baselineHandlingMinutes != null ? 'configured' : null;
  if (baselineHandlingMinutes == null && aiComparison.none.handledCount >= MIN_BASELINE_SAMPLE) {
    baselineHandlingMinutes = aiComparison.none.handlingMedian;
    baselineSource = 'no_ai_group';
  }

  // Only claim a saving when we have both a baseline AND enough measured
  // active-work tickets to trust the "time now" median.
  const canMeasureSaving =
    baselineHandlingMinutes != null && activeNowList.length >= MIN_ACTIVE_SAMPLE;
  const savedMinutesPerTicket = canMeasureSaving
    ? Math.max(0, baselineHandlingMinutes! - activeNowMedian)
    : null;
  // The per-ticket saving applies to every ticket resolved in range.
  const savedHours =
    savedMinutesPerTicket != null ? (savedMinutesPerTicket * sentInRange.length) / 60 : null;
  const hourlyCost = reportSettings?.agentHourlyCost ?? null;
  const moneySaved =
    savedHours != null && hourlyCost != null ? Math.round(savedHours * hourlyCost) : null;

  const savings = {
    agentHourlyCost: hourlyCost,
    baselineHandlingMinutes,
    baselineResponseHours: reportSettings?.baselineResponseHours ?? null,
    baselineSource,
    ticketsHandled: sentInRange.length,
    activeWorkMedianMinutes: Math.round(activeNowMedian * 10) / 10,
    activeWorkSampleCount: activeNowList.length,
    savedMinutesPerTicket: savedMinutesPerTicket != null ? Math.round(savedMinutesPerTicket) : null,
    savedHours: savedHours != null ? Math.round(savedHours * 10) / 10 : null,
    moneySaved,
  };

  // Real "time inside the ticket": accumulated active presence seconds (see
  // the presence route) for replies sent in the window. Distinct from the
  // workStartedAt → sentAt span, which also includes time the ticket just
  // sat open. Only tickets with measured activity count.
  const activeSecondsList = sentInRange
    .map((tk) => tk.activeWorkSeconds ?? 0)
    .filter((s) => s > 0);
  const activeWork = {
    count: activeSecondsList.length,
    medianMinutes:
      activeSecondsList.length > 0 ? Math.round((median(activeSecondsList) / 60) * 10) / 10 : 0,
    avgMinutes:
      activeSecondsList.length > 0
        ? Math.round((activeSecondsList.reduce((a, b) => a + b, 0) / activeSecondsList.length / 60) * 10) / 10
        : 0,
  };

  const todayKey = dayKey(now);
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
  for (const agent of getAgents()) {
    perUserMap.set(agent, { name: agent, assigned: 0, sent: 0 });
  }
  // sentBy is stored as session.user.name OR session.user.email —
  // resolveAgentName (lib/agent-match.ts) maps both forms back to the
  // canonical agent name; unknown names keep their raw value so nothing
  // is hidden.
  const bump = (raw: string, field: 'assigned' | 'sent') => {
    const name = resolveAgentName(raw) ?? raw;
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

  // ── Volume heatmap: arrivals per Stockholm weekday × hour ────────────
  // Follows the active filters (it describes the same population as the
  // activity chart). Monday = row 0.
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const t of tickets) {
    const slot = stockholmSlot(t.createdAt);
    if (slot.weekday >= 0) heatmap[slot.weekday][slot.hour] += 1;
  }

  const reportableReplies = replyEvents.filter(
    (e) =>
      isReportable(e.ticket) &&
      (!agentFilter || e.actor === agentFilter)
  );

  // First reply per ticket within the window; tickets that already had a
  // reply BEFORE the window are not "first responses" and are excluded.
  const repliesByTicket = new Map<string, { first: Date; ticketCreatedAt: Date }>();
  for (const e of reportableReplies) {
    if (!repliesByTicket.has(e.ticketId)) {
      repliesByTicket.set(e.ticketId, { first: e.createdAt, ticketCreatedAt: e.ticket.createdAt });
    }
  }
  const replyTicketIds = Array.from(repliesByTicket.keys());
  const earlierReplies = replyTicketIds.length > 0
    ? await prisma.ticketEvent.findMany({
        where: {
          ticketId: { in: replyTicketIds },
          type: TICKET_EVENT.replySent,
          createdAt: { lt: windowStart },
        },
        select: { ticketId: true },
        distinct: ['ticketId'],
      })
    : [];
  const hadEarlierReply = new Set(earlierReplies.map((e) => e.ticketId));

  const firstPairs = Array.from(repliesByTicket.entries())
    .filter(([id]) => !hadEarlierReply.has(id))
    .map(([, v]) => v)
    .filter((v) => v.first.getTime() >= v.ticketCreatedAt.getTime());
  const firstCalendarList = firstPairs.map(
    (v) => (v.first.getTime() - v.ticketCreatedAt.getTime()) / HOUR_MS
  );
  // Primary figures follow the configured basis; calendar always kept as
  // the secondary perspective (what the customer experiences).
  const firstBusinessList = businessHours
    ? firstPairs.map((v) => businessHoursBetween(businessHours, v.ticketCreatedAt, v.first))
    : null;
  const firstPrimaryList = firstBusinessList ?? firstCalendarList;
  const firstResponse = {
    count: firstPairs.length,
    basis: businessHours ? ('business' as const) : ('calendar' as const),
    medianHours: Math.round(median(firstPrimaryList) * 10) / 10,
    p90Hours: Math.round(percentile(firstPrimaryList, 90) * 10) / 10,
    medianHoursCalendar: Math.round(median(firstCalendarList) * 10) / 10,
    p90HoursCalendar: Math.round(percentile(firstCalendarList, 90) * 10) / 10,
  };

  // Replies per ticket: for tickets with at least one reply in the window,
  // how many replies has the whole conversation taken? (Counts the
  // ticket's replies across its lifetime, not just inside the window —
  // "how many rounds does a case take" is a property of the case.)
  const replyCounts = replyTicketIds.length > 0
    ? await prisma.ticketEvent.groupBy({
        by: ['ticketId'],
        where: { ticketId: { in: replyTicketIds }, type: TICKET_EVENT.replySent },
        _count: { _all: true },
      })
    : [];
  const countsList = replyCounts.map((r) => r._count._all);
  const repliesPerTicket = {
    ticketCount: countsList.length,
    avg:
      countsList.length > 0
        ? Math.round((countsList.reduce((a, b) => a + b, 0) / countsList.length) * 10) / 10
        : 0,
    distribution: {
      one: countsList.filter((c) => c === 1).length,
      two: countsList.filter((c) => c === 2).length,
      threePlus: countsList.filter((c) => c >= 3).length,
    },
  };

  // When did the event log start? Metrics derived from status changes
  // (backlog closure times, reopen rate) are only exact after this moment;
  // earlier windows are flagged approximate.
  const firstStatusEvent = await prisma.ticketEvent.findFirst({
    where: { tenantId, type: TICKET_EVENT.statusChanged },
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const eventLogStartMs = firstStatusEvent?.createdAt.getTime() ?? now.getTime();

  // ── Follow-up quality: reopen rate + one-touch resolution ────────────
  // Reopen = a status change from a terminal status back to an open one.
  // A high reopen rate means "closed" doesn't stick — cases come back.
  // Rates are only claimed when the event log covers the window and the
  // denominator is big enough (MIN_RATE_SAMPLE) to mean something.
  const statusEventsInWindow = await prisma.ticketEvent.findMany({
    where: {
      tenantId,
      type: TICKET_EVENT.statusChanged,
      createdAt: { gte: windowStart, lte: windowEnd },
    },
    select: {
      ticketId: true,
      fromValue: true,
      toValue: true,
      ticket: { select: { customerEmail: true, subject: true } },
    },
  });
  const closedSet = new Set<string>();
  const reopenedSet = new Set<string>();
  for (const e of statusEventsInWindow) {
    if (isVendorTicket(e.ticket) || isBounceTicket(e.ticket)) continue;
    if (e.toValue && TERMINAL_STATUSES.includes(e.toValue)) closedSet.add(e.ticketId);
    if (
      e.fromValue && TERMINAL_STATUSES.includes(e.fromValue) &&
      e.toValue && OPEN_STATUSES.includes(e.toValue)
    ) {
      reopenedSet.add(e.ticketId);
    }
  }
  const followUpCovered = eventLogStartMs <= windowStart.getTime();

  // One-touch resolution: of the tickets that got a reply in the window and
  // are now resolved, how many needed exactly one reply in total? Uses the
  // same lifetime reply counts as repliesPerTicket.
  const statusByReplyTicket = new Map<string, string>();
  for (const e of reportableReplies) statusByReplyTicket.set(e.ticketId, e.ticket.status);
  let resolvedReplyTickets = 0;
  let resolvedWithOneReply = 0;
  for (const r of replyCounts) {
    const status = statusByReplyTicket.get(r.ticketId);
    if (!status || !TERMINAL_STATUSES.includes(status)) continue;
    resolvedReplyTickets += 1;
    if (r._count._all === 1) resolvedWithOneReply += 1;
  }

  const followUp = {
    covered: followUpCovered,
    closedCount: closedSet.size,
    reopenedCount: reopenedSet.size,
    reopenRatePct:
      followUpCovered && closedSet.size >= MIN_RATE_SAMPLE
        ? Math.round((reopenedSet.size / closedSet.size) * 100)
        : null,
    oneTouch: {
      resolved: resolvedReplyTickets,
      oneReply: resolvedWithOneReply,
      pct:
        resolvedReplyTickets >= MIN_RATE_SAMPLE
          ? Math.round((resolvedWithOneReply / resolvedReplyTickets) * 100)
          : null,
    },
  };

  // ── SLA vs the configured first-response target ──────────────────────
  // Team-level truth: computed from the UNFILTERED reportable population.
  // Null target → null payload; the page hides the panel and prompts for
  // a target instead of assuming one (same philosophy as the ROI panel).
  const slaTarget = reportSettings?.slaFirstResponseHours ?? null;
  let sla: null | {
    targetHours: number;
    basis: 'business' | 'calendar';
    answered: number;
    met: number;
    attainmentPct: number | null;
    openOverdue: {
      count: number;
      tickets: Array<{ id: string; subject: string; ageHours: number; ageHoursCalendar: number }>;
    };
  } = null;
  if (slaTarget != null) {
    const createdIds = reportableTickets.map((t) => t.id);
    const firstReplies = createdIds.length > 0
      ? await prisma.ticketEvent.groupBy({
          by: ['ticketId'],
          where: { ticketId: { in: createdIds }, type: TICKET_EVENT.replySent },
          _min: { createdAt: true },
        })
      : [];
    const firstReplyAt = new Map<string, Date>();
    for (const r of firstReplies) {
      if (r._min.createdAt) firstReplyAt.set(r.ticketId, r._min.createdAt);
    }
    // Elapsed time to first reply in the configured basis. A mail that
    // arrives while closed and is answered before the next opening has 0
    // open hours elapsed → met — correct: the team answered before the
    // SLA clock even started.
    let answered = 0;
    let met = 0;
    for (const t of reportableTickets) {
      const fr = firstReplyAt.get(t.id);
      if (!fr) continue;
      answered += 1;
      const elapsed = businessHours
        ? businessHoursBetween(businessHours, t.createdAt, fr)
        : (fr.getTime() - t.createdAt.getTime()) / HOUR_MS;
      if (elapsed <= slaTarget) met += 1;
    }

    // Follow-up list: open tickets already past the target with no reply
    // at all — the ones an agent should grab next. Regardless of the
    // selected range (an overdue ticket from before the window still needs
    // answering). Shared with the SLA alert cron via findOverdueUnanswered.
    const overdue = await findOverdueUnanswered(tenantId, slaTarget, now, businessHours);

    sla = {
      targetHours: slaTarget,
      basis: businessHours ? 'business' : 'calendar',
      answered,
      met,
      attainmentPct: answered > 0 ? Math.round((met / answered) * 100) : null,
      openOverdue: {
        count: overdue.length,
        tickets: overdue.slice(0, 20).map((t) => ({
          id: t.id,
          subject: t.subject,
          // Age in the active basis; calendar always included so the UI
          // can phrase long waits in "dygn" regardless of basis.
          ageHours: businessHours
            ? Math.round(businessHoursBetween(businessHours, t.createdAt, now))
            : Math.round((now.getTime() - t.createdAt.getTime()) / HOUR_MS),
          ageHoursCalendar: Math.round((now.getTime() - t.createdAt.getTime()) / HOUR_MS),
        })),
      },
    };
  }

  // ── Backlog: open reportable tickets at the end of each day ──────────
  // Closure moments come from the event log where it exists; tickets that
  // reached a terminal status before event logging began fall back to
  // sentAt ?? updatedAt, and day buckets that end before the first logged
  // status change are flagged approximate (the page renders them muted).
  // Team-level truth (ignores filters), skipped for the hourly 1d view.
  let backlog: Array<{ date: string; open: number; approximate: boolean }> = [];
  if (!isHourly) {
    const backlogRows = await prisma.ticket.findMany({
      where: {
        tenantId,
        createdAt: { lte: windowEnd },
        // Closed-before-the-window tickets can't affect any bucket; only
        // still-open tickets and those touched since the window began can.
        OR: [
          { status: { in: OPEN_STATUSES } },
          { updatedAt: { gte: windowStart } },
        ],
        NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        sentAt: true,
        customerEmail: true,
        subject: true,
      },
    });
    const backlogTickets = backlogRows.filter(
      (t) => t.status !== 'duplicate' && !isVendorTicket(t) && !isBounceTicket(t)
    );

    const terminalIds = backlogTickets
      .filter((t) => TERMINAL_STATUSES.includes(t.status))
      .map((t) => t.id);
    const terminalEvents = terminalIds.length > 0
      ? await prisma.ticketEvent.findMany({
          where: {
            ticketId: { in: terminalIds },
            type: TICKET_EVENT.statusChanged,
            toValue: { in: TERMINAL_STATUSES },
          },
          select: { ticketId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const lastTerminalAt = new Map<string, Date>();
    for (const e of terminalEvents) lastTerminalAt.set(e.ticketId, e.createdAt); // asc → last wins

    const closedAt = new Map<string, { at: number; exact: boolean }>();
    for (const t of backlogTickets) {
      if (!TERMINAL_STATUSES.includes(t.status)) continue;
      const evt = lastTerminalAt.get(t.id);
      closedAt.set(
        t.id,
        evt
          ? { at: evt.getTime(), exact: true }
          : { at: (t.sentAt ?? t.updatedAt).getTime(), exact: false }
      );
    }

    backlog = bucketKeys.map((key) => {
      const dayEndMs = Math.min(
        stockholmMidnight(shiftDayKey(key, 1)).getTime(),
        now.getTime()
      );
      let open = 0;
      for (const t of backlogTickets) {
        if (t.createdAt.getTime() > dayEndMs) continue;
        const closed = closedAt.get(t.id);
        if (!closed || closed.at > dayEndMs) open += 1;
      }
      return { date: key, open, approximate: dayEndMs <= eventLogStartMs };
    });
  }

  // ── Previous-period comparison ───────────────────────────────────────
  // The same KPI definitions over the period immediately before the window
  // (same elapsed portion for current/rolling ranges). The page renders
  // delta badges from this; it never invents a delta the sample can't carry.
  const prev = previousReportWindow(range, { windowStart, windowEnd, isHourly }, now);
  const comparison = await computeKpiSummary(
    tenantId,
    prev.windowStart,
    prev.windowEnd,
    { agent: agentFilter, status: statusFilter, priority: priorityFilter, category: categoryFilter },
    slaTarget,
    businessHours
  );

  return {
    totalTickets,
    ticketsByStatus,
    ticketsByPriority,
    // Median is the headline response time; mean kept as a secondary figure.
    medianResponseTime: Math.round(medianResponseTime * 10) / 10,
    avgResponseTime: Math.round(avgResponseTime * 10) / 10,
    // Legacy workStartedAt→sentAt figure — no longer shown as a headline
    // (it includes queue time); kept in the payload for backwards-compat.
    avgHandlingMinutes: Math.round(avgHandlingTime),
    handledCount: handledInRange.length,
    resolvedToday,
    pendingTickets,
    // Total replies sent in range — lets the UI show each agent's share.
    totalSent: sentInRange.length,
    recentActivity,
    // Tells the client how to label the activity bars ("14:00" vs "3 jun").
    activityInterval: isHourly ? 'hour' : 'day',
    perUserStats,
    // Value-case payloads (see blocks above).
    trend,
    aiComparison,
    savings,
    editStats,
    activeWork,
    // New flexibility payloads: which filters were actually applied (after
    // validation), plus the event-log-backed metrics.
    filtersApplied: {
      agent: agentFilter,
      status: statusFilter,
      priority: priorityFilter,
      category: categoryFilter,
    },
    heatmap,
    firstResponse,
    repliesPerTicket,
    // "What do customers ask about": counts + response medians per category,
    // over the same filtered populations as the rest of the report.
    ticketsByCategory: categoryStats(tickets, sentInRange),
    // Customer satisfaction from the one-click email links. Team-level
    // (ignores filters — a rating belongs to the ticket, not the view).
    // sharePct is only claimed at MIN_CSAT_SAMPLE responses or more; the
    // negative drill-down lists the latest cases to follow up.
    csat: (() => {
      const positive = csatRows.filter((r) => r.rating === 'positive').length;
      return {
        count: csatRows.length,
        positive,
        negative: csatRows.length - positive,
        sharePct:
          csatRows.length >= MIN_CSAT_SAMPLE
            ? Math.round((positive / csatRows.length) * 100)
            : null,
        negatives: csatRows
          .filter((r) => r.rating === 'negative')
          .slice(0, 10)
          .map((r) => ({
            ticketId: r.ticketId,
            subject: r.ticket.subject,
            comment: r.comment,
            createdAt: r.createdAt,
          })),
      };
    })(),
    followUp,
    sla,
    backlog,
    comparison,
  };
}
