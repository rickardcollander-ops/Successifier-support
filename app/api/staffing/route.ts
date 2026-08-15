import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';
import { isReportable } from '@/lib/ticket-filters';
import { DAY_MS, stockholmSlot } from '@/lib/time/stockholm';
import {
  buildArrivalProfile,
  requiredAgentsGrid,
  actualHoursGrid,
  weekdaySummary,
  DEFAULT_OCCUPANCY,
  DEFAULT_SHRINKAGE,
} from '@/lib/staffing';
import { parseBusinessHours, openMask } from '@/lib/business-hours';

// Same exclusion as the reports API — the Zendesk history import must not
// look like arrival volume.
const ZENDESK_IMPORT_MARKER = '[Zendesk Import Source:';

// Need at least this many tickets with measured active work time before the
// median is a claim (mirrors the reports savings guard).
const MIN_AHT_SAMPLE = 10;

// Staffing recommendation data for the bemanning page: the historical
// arrival profile (used as the forecast — a simple per-slot average over the
// lookback, deliberately explainable), the required-agents grid derived from
// it, and the actually-worked hours from the persisted work sessions.
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenant = await getTenant();
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Lookback in whole rolling weeks so every weekday×hour slot is observed
    // the same number of times — otherwise the partial week biases the
    // profile low on some weekdays.
    const weeksParam = parseInt(request.nextUrl.searchParams.get('weeks') || '8', 10);
    const weeks = Number.isFinite(weeksParam) ? Math.min(12, Math.max(2, weeksParam)) : 8;
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - weeks * 7 * DAY_MS);

    const settings = await prisma.reportSettings.findUnique({ where: { tenantId: tenant.id } });
    const occupancy = settings?.staffingOccupancy ?? DEFAULT_OCCUPANCY;
    const shrinkage = settings?.staffingShrinkage ?? DEFAULT_SHRINKAGE;
    // Smooth the workload over (roughly) the SLA window, capped at 4h — email
    // can queue inside the SLA, so a spike hour is absorbed by the hours
    // after it. Without an SLA target, no smoothing.
    const slaHours = settings?.slaFirstResponseHours ?? null;
    const smoothingHours = slaHours != null ? Math.min(4, Math.max(1, Math.round(slaHours))) : 1;

    // Öppettider: when configured, agents are only planned during open
    // hours and closed-hour volume rolls forward to opening (see
    // lib/staffing.ts). Null = 24/7, exactly the pre-öppettider behavior.
    const businessHours = parseBusinessHours(settings?.businessHours ?? null);
    const mask = businessHours ? openMask(businessHours) : undefined;

    // Arrival profile from ticket creation times (true arrival timestamps —
    // createdAt carries Gmail's internalDate).
    const arrivedRows = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        createdAt: { gte: lookbackStart },
        NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
      },
      select: { status: true, customerEmail: true, subject: true, createdAt: true },
    });
    const arrivals = arrivedRows
      .filter(isReportable)
      .map((t) => stockholmSlot(t.createdAt));
    const profile = buildArrivalProfile(arrivals, weeks);

    // AHT: median measured active work time of replies sent in the lookback.
    // Falls back to the configured "before the tool" baseline when there are
    // too few measured tickets, and to null (page shows a "för lite data"
    // prompt) when neither exists.
    const sentRows = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        sentAt: { gte: lookbackStart },
        activeWorkSeconds: { gt: 0 },
        NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
      },
      select: { status: true, customerEmail: true, subject: true, activeWorkSeconds: true },
    });
    const ahtSamples = sentRows
      .filter(isReportable)
      .map((t) => t.activeWorkSeconds / 60)
      .sort((a, b) => a - b);
    const medianAht =
      ahtSamples.length > 0
        ? ahtSamples.length % 2 === 1
          ? ahtSamples[(ahtSamples.length - 1) / 2]
          : (ahtSamples[ahtSamples.length / 2 - 1] + ahtSamples[ahtSamples.length / 2]) / 2
        : 0;

    let aht: { minutes: number; sampleCount: number; source: 'measured' | 'baseline' } | null = null;
    if (ahtSamples.length >= MIN_AHT_SAMPLE) {
      aht = { minutes: Math.round(medianAht * 10) / 10, sampleCount: ahtSamples.length, source: 'measured' };
    } else if (settings?.baselineHandlingMinutes != null) {
      aht = { minutes: settings.baselineHandlingMinutes, sampleCount: ahtSamples.length, source: 'baseline' };
    }

    const requiredFull = aht
      ? requiredAgentsGrid(profile, aht.minutes, { occupancy, shrinkage, smoothingHours, openMask: mask })
      : null;
    // Round the demand grids for transport: one decimal, but never let a
    // slot that needs SOME agent round down to a blank 0.0.
    const roundDemand = (grid: number[][]) =>
      grid.map((row) => row.map((d) => (d > 0 ? Math.max(0.1, Math.round(d * 10) / 10) : 0)));
    const required = requiredFull
      ? {
          raw: requiredFull.raw,
          smoothed: requiredFull.smoothed,
          rawDemand: roundDemand(requiredFull.rawDemand),
          smoothedDemand: roundDemand(requiredFull.smoothedDemand),
        }
      : null;

    // Actually worked hours from the persisted sessions. Forward-filling
    // data — sessionsSince tells the page when measuring began so the
    // comparison can carry a "mäts sedan …" caveat.
    const firstSession = await prisma.agentWorkSession.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { startedAt: 'asc' },
      select: { startedAt: true },
    });
    const sessions = await prisma.agentWorkSession.findMany({
      where: { tenantId: tenant.id, startedAt: { gte: lookbackStart } },
      select: { startedAt: true, lastSeenAt: true },
    });
    // Normalise by the weeks actually measured, not the whole lookback —
    // otherwise the "actual" side reads absurdly low right after go-live.
    const measuredWeeks = firstSession
      ? Math.min(
          weeks,
          Math.max(1 / 7, (now.getTime() - Math.max(firstSession.startedAt.getTime(), lookbackStart.getTime())) / (7 * DAY_MS))
        )
      : weeks;
    const actual = actualHoursGrid(sessions, measuredWeeks);

    return NextResponse.json({
      profile,
      required,
      actual,
      aht,
      sessionsSince: firstSession?.startedAt ?? null,
      businessHours,
      params: { weeks, occupancy, shrinkage, smoothingHours, slaHours },
      weekdaySummary: requiredFull
        ? weekdaySummary(requiredFull.smoothed, requiredFull.smoothedDemand)
        : null,
      totalArrivals: arrivals.length,
    });
  } catch (error) {
    console.error('Error computing staffing data:', error);
    return NextResponse.json({ error: 'Failed to compute staffing data' }, { status: 500 });
  }
}
