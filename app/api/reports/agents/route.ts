import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { stripAgentSignature } from '@/lib/constants';
import { isVendorTicket, isBounceTicket, isReportable } from '@/lib/ticket-filters';
import { resolveAgentName } from '@/lib/agent-match';
import { requireApiAuth } from '@/lib/api-auth';
import { keptFromDraftRatio } from '@/lib/text-diff';
import { resolveReportWindow } from '@/lib/report-window';
import { TICKET_EVENT } from '@/lib/services/ticket-events';
import { median, ZENDESK_IMPORT_MARKER } from '@/lib/reports/compute';

// Drill-down behind the "Ärenden per medarbetare" table: per-agent medians
// (response time, active work, kept-from-draft share) that the aggregate
// table doesn't show. Same range parameters and exclusions as /api/reports,
// so counts always reconcile with the table.
//
// Response time here is the per-reply responseSeconds from the event log —
// time from the customer's latest message to THAT agent's reply — which is
// the fairest per-agent figure (a slow first reply on a ticket someone else
// later answers shouldn't land on the second agent).

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

    const { windowStart, windowEnd } = resolveReportWindow(
      range,
      searchParams.get('from'),
      searchParams.get('to')
    );

    const [replyEvents, sentRows, feedbackRows] = await Promise.all([
      prisma.ticketEvent.findMany({
        where: {
          tenantId: tenant.id,
          type: TICKET_EVENT.replySent,
          createdAt: { gte: windowStart, lt: windowEnd },
        },
        select: {
          actor: true,
          responseSeconds: true,
          ticket: { select: { customerEmail: true, subject: true, status: true, createdAt: true } },
        },
      }),
      prisma.ticket.findMany({
        where: {
          tenantId: tenant.id,
          sentAt: { gte: windowStart, lt: windowEnd },
          NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
        },
        select: {
          id: true,
          customerEmail: true,
          subject: true,
          sentBy: true,
          activeWorkSeconds: true,
          aiResponse: true,
          finalResponse: true,
        },
      }),
      prisma.aIResponseFeedback.findMany({
        where: { tenantId: tenant.id, createdAt: { gte: windowStart, lt: windowEnd } },
        select: { ticketId: true, wasEdited: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const editedByTicket = new Map<string, boolean>();
    for (const f of feedbackRows) editedByTicket.set(f.ticketId, f.wasEdited); // last write wins

    const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
    // Same reduction as /api/reports: drop the inline-image HTML tail and the
    // auto-appended signature before comparing draft with sent reply.
    const comparableBody = (s: string | null | undefined) =>
      stripAgentSignature((s ?? '').split('[INLINE_IMAGES]')[0]);

    type PerAgent = {
      replies: number;
      responseSecondsList: number[];
      activeMinutesList: number[];
      keptRatios: number[];
    };
    const byAgent = new Map<string, PerAgent>();
    const bucket = (raw: string | null | undefined): PerAgent | null => {
      if (!raw) return null;
      const name = resolveAgentName(raw) ?? raw;
      let entry = byAgent.get(name);
      if (!entry) {
        entry = { replies: 0, responseSecondsList: [], activeMinutesList: [], keptRatios: [] };
        byAgent.set(name, entry);
      }
      return entry;
    };

    for (const e of replyEvents) {
      if (!isReportable(e.ticket)) continue;
      const entry = bucket(e.actor);
      if (!entry) continue;
      entry.replies += 1;
      if (e.responseSeconds != null && e.responseSeconds >= 0) {
        entry.responseSecondsList.push(e.responseSeconds);
      }
    }

    for (const t of sentRows) {
      if (isVendorTicket(t) || isBounceTicket(t)) continue;
      const entry = bucket(t.sentBy);
      if (!entry) continue;
      if ((t.activeWorkSeconds ?? 0) > 0) {
        entry.activeMinutesList.push((t.activeWorkSeconds ?? 0) / 60);
      }
      const fb = editedByTicket.get(t.id);
      const hasDraft = norm(comparableBody(t.aiResponse)) !== '';
      if (!hasDraft && fb === undefined) continue;
      const kept = fb === false
        ? 1
        : keptFromDraftRatio(comparableBody(t.aiResponse), comparableBody(t.finalResponse));
      if (kept != null) entry.keptRatios.push(kept);
    }

    const agents = Array.from(byAgent.entries())
      .map(([name, s]) => ({
        name,
        replies: s.replies,
        // Counts ship alongside every median so the UI can refuse to show a
        // figure the sample can't carry (same philosophy as the ROI panel).
        responseCount: s.responseSecondsList.length,
        responseMedianHours:
          Math.round((median(s.responseSecondsList) / 3600) * 10) / 10,
        activeWorkCount: s.activeMinutesList.length,
        activeWorkMedianMinutes: Math.round(median(s.activeMinutesList) * 10) / 10,
        keptCount: s.keptRatios.length,
        keptMedianPct: Math.round(median(s.keptRatios) * 100),
      }))
      .sort((a, b) => b.replies - a.replies || a.name.localeCompare(b.name));

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('Error fetching per-agent report:', error);
    return NextResponse.json(
      { error: 'Failed to fetch per-agent report' },
      { status: 500 }
    );
  }
}
