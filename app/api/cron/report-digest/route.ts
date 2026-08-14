import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { product } from '@/lib/products';
import { requireCronSecret } from '@/lib/cron-auth';
import { decryptCredentials } from '@/lib/integrations/credentials';
import { ResendService } from '@/lib/integrations/resend';
import { computeKpiSummary, previousReportWindow, findOverdueUnanswered } from '@/lib/reports/compute';
import { buildDigestEmail } from '@/lib/reports/digest-email';
import { resolveReportWindow } from '@/lib/report-window';
import { dayKey, stockholmWeekday } from '@/lib/time/stockholm';

// Scheduled report digest. Invoked DAILY by Vercel Cron (see vercel.json);
// the route itself decides whether today is a send day for this tenant:
// weekly digests go out on Stockholm Mondays covering last week, monthly on
// the 1st covering last month. digestLastSentAt makes re-fired runs
// idempotent — a second invocation the same day sees the digest was already
// sent and does nothing. Each deployment serves exactly one tenant
// (lib/products/tenant.ts), so no tenant iteration is needed here.

export async function GET(request: NextRequest) {
  const authResult = requireCronSecret(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenant = await getTenant();
    if (!tenant) {
      return NextResponse.json({ skipped: 'no tenant' });
    }
    const settings = await prisma.reportSettings.findUnique({
      where: { tenantId: tenant.id },
    });
    const frequency = settings?.digestFrequency;
    const recipients = settings?.digestRecipients ?? [];
    if ((frequency !== 'weekly' && frequency !== 'monthly') || recipients.length === 0) {
      return NextResponse.json({ skipped: 'digest not configured' });
    }

    const now = new Date();
    const todayKey = dayKey(now);
    const lastSent = settings?.digestLastSentAt ?? null;
    // Guard against double sends: the cron fires daily, so "already sent
    // today or later this period" means skip. 3/7-day margins keep a manual
    // re-fire from double-sending without ever skipping a real period.
    const sentRecently = (days: number) =>
      lastSent != null && now.getTime() - lastSent.getTime() < days * 24 * 3600 * 1000;
    const isSendDay =
      frequency === 'weekly'
        ? stockholmWeekday(now) === 0 && !sentRecently(3)
        : todayKey.endsWith('-01') && !sentRecently(7);
    if (!isSendDay) {
      return NextResponse.json({ skipped: 'not a send day' });
    }

    const range = frequency === 'weekly' ? 'lastWeek' : 'lastMonth';
    const win = resolveReportWindow(range, null, null, now);
    const prev = previousReportWindow(range, win, now);
    const slaTarget = settings?.slaFirstResponseHours ?? null;

    const [summary, previous] = await Promise.all([
      computeKpiSummary(tenant.id, win.windowStart, win.windowEnd, undefined, slaTarget),
      computeKpiSummary(tenant.id, prev.windowStart, prev.windowEnd, undefined, slaTarget),
    ]);
    const overdueCount =
      slaTarget != null ? (await findOverdueUnanswered(tenant.id, slaTarget, now)).length : null;

    // Period label: "11 aug – 17 aug 2026" (the window end is exclusive).
    const locale = product.language === 'sv' ? 'sv-SE' : 'en-GB';
    const fmt = (d: Date) =>
      d.toLocaleDateString(locale, { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short' });
    const lastIncluded = new Date(win.windowEnd.getTime() - 1);
    const periodLabel = `${fmt(win.windowStart)} – ${fmt(lastIncluded)} ${lastIncluded.getFullYear()}`;

    const { subject, html } = buildDigestEmail(summary, previous, {
      tenantName: product.displayName,
      language: product.language,
      periodLabel,
      appBaseUrl: process.env.APP_BASE_URL || null,
      overdueCount,
    });

    // Send via the tenant's Resend integration — same path as the send
    // route's fallback branch.
    const resendIntegration = await prisma.integration.findFirst({
      where: { tenantId: tenant.id, type: 'resend', isActive: true },
    });
    if (!resendIntegration) {
      return NextResponse.json({ skipped: 'no active resend integration' });
    }
    const credentials = decryptCredentials(resendIntegration.credentials);
    const resend = new ResendService(credentials.apiKey, credentials.fromEmail);
    for (const to of recipients) {
      await resend.sendEmail(to, subject, html);
    }

    await prisma.reportSettings.update({
      where: { tenantId: tenant.id },
      data: { digestLastSentAt: now },
    });

    return NextResponse.json({ sent: true, frequency, recipients: recipients.length });
  } catch (error) {
    console.error('Error sending report digest:', error);
    return NextResponse.json({ error: 'Failed to send report digest' }, { status: 500 });
  }
}
