import { NextRequest, NextResponse } from 'next/server';
import type { Tenant } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { buildTenantConfig } from '@/lib/products/tenant';
import { billingState } from '@/lib/billing';
import { requireCronSecret } from '@/lib/cron-auth';
import { decryptCredentials } from '@/lib/integrations/credentials';
import { ResendService } from '@/lib/integrations/resend';
import { computeKpiSummary, previousReportWindow, findOverdueUnanswered } from '@/lib/reports/compute';
import { parseBusinessHours } from '@/lib/business-hours';
import { buildDigestEmail } from '@/lib/reports/digest-email';
import { resolveReportWindow } from '@/lib/report-window';
import { dayKey, stockholmWeekday } from '@/lib/time/stockholm';

// Scheduled report digest. Invoked DAILY by Vercel Cron (see vercel.json);
// the route iterates EVERY tenant on the platform and decides per tenant
// whether today is a send day: weekly digests go out on Stockholm Mondays
// covering last week, monthly on the 1st covering last month.
// digestLastSentAt makes re-fired runs idempotent — a second invocation the
// same day sees the digest was already sent and does nothing.

async function runDigestForTenant(tenant: Tenant, now: Date): Promise<Record<string, unknown>> {
  const settings = await prisma.reportSettings.findUnique({
    where: { tenantId: tenant.id },
  });
  const frequency = settings?.digestFrequency;
  const recipients = settings?.digestRecipients ?? [];
  if ((frequency !== 'weekly' && frequency !== 'monthly') || recipients.length === 0) {
    return { skipped: 'digest not configured' };
  }

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
    return { skipped: 'not a send day' };
  }

  const config = buildTenantConfig(tenant);
  const range = frequency === 'weekly' ? 'lastWeek' : 'lastMonth';
  const win = resolveReportWindow(range, null, null, now);
  const prev = previousReportWindow(range, win, now);
  const slaTarget = settings?.slaFirstResponseHours ?? null;
  // Öppettider: same basis for SLA/first-response as the reports page.
  const businessHours = parseBusinessHours(settings?.businessHours ?? null);

  const [summary, previous] = await Promise.all([
    computeKpiSummary(tenant.id, win.windowStart, win.windowEnd, undefined, slaTarget, businessHours),
    computeKpiSummary(tenant.id, prev.windowStart, prev.windowEnd, undefined, slaTarget, businessHours),
  ]);
  const overdueCount =
    slaTarget != null
      ? (await findOverdueUnanswered(tenant.id, slaTarget, now, businessHours)).length
      : null;

  // Period label: "11 aug – 17 aug 2026" (the window end is exclusive).
  const locale = config.language === 'sv' ? 'sv-SE' : 'en-GB';
  const fmt = (d: Date) =>
    d.toLocaleDateString(locale, { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short' });
  const lastIncluded = new Date(win.windowEnd.getTime() - 1);
  const periodLabel = `${fmt(win.windowStart)} – ${fmt(lastIncluded)} ${lastIncluded.getFullYear()}`;

  const { subject, html } = buildDigestEmail(summary, previous, {
    tenantName: config.displayName,
    language: config.language,
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
    return { skipped: 'no active resend integration' };
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

  return { sent: true, frequency, recipients: recipients.length };
}

export async function GET(request: NextRequest) {
  const authResult = requireCronSecret(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
    const now = new Date();
    const results: Record<string, unknown> = {};
    for (const tenant of tenants) {
      // Blocked subscriptions (expired trial, canceled, suspended) get no
      // scheduled mail — one tenant failing must not stop the rest either.
      if (!billingState(tenant).active) {
        results[tenant.subdomain] = { skipped: 'subscription inactive' };
        continue;
      }
      try {
        results[tenant.subdomain] = await runDigestForTenant(tenant, now);
      } catch (error) {
        console.error(`Error sending report digest for ${tenant.subdomain}:`, error);
        results[tenant.subdomain] = { error: 'failed' };
      }
    }
    return NextResponse.json({ tenants: results });
  } catch (error) {
    console.error('Error sending report digests:', error);
    return NextResponse.json({ error: 'Failed to send report digest' }, { status: 500 });
  }
}
