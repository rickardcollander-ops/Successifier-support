import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { AGENTS, stripAgentSignature } from '@/lib/constants';
import { isVendorTicket, isBounceTicket } from '@/lib/ticket-filters';
import { requireApiAuth } from '@/lib/api-auth';
import { keptFromDraftRatio } from '@/lib/text-diff';

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

// Median is the headline number for time-to-X: a couple of tickets left open
// over a weekend skew the mean badly, and "half our tickets are answered
// faster than X" is the claim that actually survives scrutiny.
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// p90 sits next to the median to show the tail — "even the slow ones are
// under X". Nearest-rank, which is plenty for a dashboard.
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
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
    if (range !== '1d') {
      const stepDays = range === '7d' ? 1 : 7;
      const totalDays = daysAgo;
      const stepMs = stepDays * DAY_MS;
      const buckets = Math.ceil(totalDays / stepDays);
      const fmt = (d: Date) =>
        d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm', month: 'short', day: 'numeric' });
      for (let i = buckets - 1; i >= 0; i--) {
        const end = now.getTime() - i * stepMs;
        const start = end - stepMs;
        const inBucket = sentInRange.filter((t) => {
          const s = t.sentAt!.getTime();
          return s >= start && s < end;
        });
        const resp = inBucket.map(responseHours);
        const hand = inBucket.filter(hasHandling).map(handlingMinutes);
        trend.push({
          label: fmt(new Date(start)),
          responseMedian: Math.round(median(resp) * 10) / 10,
          handlingMedian: Math.round(median(hand)),
          count: inBucket.length,
        });
      }
    }

    // With vs without AI — the causal part of the case. wasEdited from the
    // AIResponseFeedback log is authoritative when present; otherwise we infer
    // from the ticket itself (no aiResponse = no AI; finalResponse equal to
    // aiResponse = sent as-is; otherwise rewritten).
    const feedbackRows = await prisma.aIResponseFeedback.findMany({
      where: { tenantId: tenant.id, createdAt: { gte: queryStart } },
      select: { ticketId: true, wasEdited: true },
      orderBy: { createdAt: 'asc' },
    });
    const editedByTicket = new Map<string, boolean>();
    for (const f of feedbackRows) editedByTicket.set(f.ticketId, f.wasEdited); // last write wins

    const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
    // Reduce a stored reply to the part that can be fairly compared with the AI
    // draft: drop the inline-image HTML tail (everything after [INLINE_IMAGES] —
    // raw <img>/data-URL markup the draft never contained, which otherwise reads
    // as a wall of inserted "words"), then strip the auto-appended signature.
    const comparableBody = (s: string | null | undefined) =>
      stripAgentSignature((s ?? '').split('[INLINE_IMAGES]')[0]);
    const asIs: typeof sentInRange = [];
    const editedGroup: typeof sentInRange = [];
    const noAi: typeof sentInRange = [];
    for (const t of sentInRange) {
      const fb = editedByTicket.get(t.id);
      let aiUsed: boolean;
      let edited: boolean;
      if (fb !== undefined) {
        aiUsed = true;
        edited = fb;
      } else if (norm(t.aiResponse)) {
        aiUsed = true;
        // Compare on equal footing: drop the inline-image HTML tail and the
        // auto-appended signature (both absent from the draft) before deciding
        // whether the agent actually edited. Without this every verbatim send
        // reads as "edited" and the "skickat oförändrat" group is starved.
        const a = norm(comparableBody(t.aiResponse));
        const f = norm(comparableBody(t.finalResponse));
        edited = !f || f !== a;
      } else {
        aiUsed = false;
        edited = false;
      }
      if (!aiUsed) noAi.push(t);
      else if (edited) editedGroup.push(t);
      else asIs.push(t);
    }
    const aiComparison = {
      asIs: groupStats(asIs),
      edited: groupStats(editedGroup),
      none: groupStats(noAi),
    };

    // Money saved = time the AI shaved off each ticket × tickets × agent cost.
    // Baseline: a configured "before our tool" handling time wins; otherwise
    // fall back to how long this same team takes WITHOUT an AI draft (the
    // no-AI group), but only when that group is big enough to mean something.
    const reportSettings = await prisma.reportSettings.findUnique({
      where: { tenantId: tenant.id },
    });
    const aiAssisted = [...asIs, ...editedGroup];
    const aiAssistedHand = aiAssisted.filter(hasHandling).map(handlingMinutes);
    const aiAssistedHandlingMedian = median(aiAssistedHand);

    let baselineHandlingMinutes: number | null = reportSettings?.baselineHandlingMinutes ?? null;
    let baselineSource: 'configured' | 'no_ai_group' | null =
      baselineHandlingMinutes != null ? 'configured' : null;
    if (baselineHandlingMinutes == null && aiComparison.none.handledCount >= 3) {
      baselineHandlingMinutes = aiComparison.none.handlingMedian;
      baselineSource = 'no_ai_group';
    }

    const savedMinutesPerTicket =
      baselineHandlingMinutes != null
        ? Math.max(0, baselineHandlingMinutes - aiAssistedHandlingMedian)
        : null;
    const savedHours =
      savedMinutesPerTicket != null ? (savedMinutesPerTicket * aiAssistedHand.length) / 60 : null;
    const hourlyCost = reportSettings?.agentHourlyCost ?? null;
    const moneySaved =
      savedHours != null && hourlyCost != null ? Math.round(savedHours * hourlyCost) : null;

    const savings = {
      agentHourlyCost: hourlyCost,
      baselineHandlingMinutes,
      baselineResponseHours: reportSettings?.baselineResponseHours ?? null,
      baselineSource,
      aiAssistedCount: aiAssistedHand.length,
      aiAssistedHandlingMedian: Math.round(aiAssistedHandlingMedian),
      savedMinutesPerTicket: savedMinutesPerTicket != null ? Math.round(savedMinutesPerTicket) : null,
      savedHours: savedHours != null ? Math.round(savedHours * 10) / 10 : null,
      moneySaved,
    };

    // How much of each SENT reply was carried over from the AI draft? We use
    // word-overlap (longest common subsequence ÷ sent length), NOT raw edit
    // distance: the AI tends to write long drafts that agents condense, and
    // edit distance counts every dropped word as a "change" — so condensed
    // replies looked "rewritten" even when every word the customer received
    // came from the AI. Overlap asks the question that actually matters: of
    // what we sent, how much did the AI write? Buckets are by NEW content
    // (1 − kept): <10% new = sent ~as the draft, 10–50% = built on the draft,
    // ≥50% = mostly written by the agent.
    const keptRatios: number[] = [];
    let editUnchanged = 0;
    let editLight = 0;
    let editHeavy = 0;
    for (const tk of sentInRange) {
      // The authoritative feedback flag wins: a reply the agent confirmed as
      // unedited is fully "from the AI" even if a stray character differs.
      if (editedByTicket.get(tk.id) === false) {
        editUnchanged++;
        keptRatios.push(1);
        continue;
      }
      // Compare only the parts present in both (no inline-image HTML, no
      // appended signature). Tickets with no AI draft fall out as null and are
      // excluded — the histogram describes AI-assisted sends only.
      const kept = keptFromDraftRatio(comparableBody(tk.aiResponse), comparableBody(tk.finalResponse));
      if (kept == null) continue;
      keptRatios.push(kept);
      const newContent = 1 - kept;
      if (newContent < 0.1) editUnchanged++;
      else if (newContent < 0.5) editLight++;
      else editHeavy++;
    }
    const medianKeptPct = keptRatios.length > 0 ? Math.round(median(keptRatios) * 100) : 0;
    const editStats = {
      count: keptRatios.length,
      // "Changed" is now the inverse of the kept share — how much of the sent
      // reply the agent wrote that wasn't in the draft.
      medianChangedPct: 100 - medianKeptPct,
      medianKeptPct,
      unchanged: editUnchanged,
      light: editLight,
      heavy: editHeavy,
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
      // Minutes of active work per ticket, plus how many tickets the average
      // is based on (lets the UI say "saknas ännu" while data builds up).
      avgHandlingMinutes: Math.round(avgHandlingTime),
      handledCount: handledInRange.length,
      resolvedToday,
      pendingTickets,
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
    });
  } catch (error) {
    console.error('Error fetching report data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch report data' },
      { status: 500 }
    );
  }
}
