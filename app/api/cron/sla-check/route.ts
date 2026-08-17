import { NextRequest, NextResponse } from 'next/server';
import type { Tenant } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { buildTenantConfig } from '@/lib/products/tenant';
import { billingState } from '@/lib/billing';
import { requireCronSecret } from '@/lib/cron-auth';
import { decryptCredentials } from '@/lib/integrations/credentials';
import { ResendService } from '@/lib/integrations/resend';
import { findOverdueUnanswered } from '@/lib/reports/compute';
import { parseBusinessHours, businessHoursBetween } from '@/lib/business-hours';
import {
  computeSlaAlerts,
  buildSlaAlertEmail,
  alertKey,
  SLA_WARNING_SHARE,
  type SlaAlertLevel,
} from '@/lib/reports/sla-alerts';
import { TICKET_EVENT, EVENT_ACTOR, logTicketEvents } from '@/lib/services/ticket-events';

// Proactive SLA alerting. Invoked hourly by Vercel Cron (see vercel.json):
// iterates EVERY tenant on the platform, finds open, still-unanswered
// tickets that have used ≥ 80% of the tenant's first-response target
// ('warning') or passed it ('breach') and emails the configured recipients
// ONE batched list per tenant. Idempotent: every sent alert is recorded as
// an 'sla_alert' TicketEvent (meta.level), and a (ticket, level) pair is
// never alerted twice — re-running the cron sends nothing new.
// The overdue population is findOverdueUnanswered — the exact query behind
// the reports page's SLA panel — so the alert list and the panel agree.

async function runSlaCheckForTenant(tenant: Tenant, now: Date): Promise<Record<string, unknown>> {
  const settings = await prisma.reportSettings.findUnique({
    where: { tenantId: tenant.id },
  });
  const target = settings?.slaFirstResponseHours ?? null;
  const recipients = settings?.alertRecipients ?? [];
  if (!settings?.slaAlertsEnabled || target == null || recipients.length === 0) {
    return { skipped: 'sla alerts not configured' };
  }

  // Öppettider: ages and thresholds count elapsed OPEN hours when
  // configured — same basis as the reports page's SLA panel.
  const businessHours = parseBusinessHours(settings?.businessHours ?? null);
  // Fetch with the WARNING threshold so approaching tickets are included;
  // computeSlaAlerts assigns the level per ticket.
  const overdue = await findOverdueUnanswered(
    tenant.id,
    target * SLA_WARNING_SHARE,
    now,
    businessHours
  );
  if (overdue.length === 0) {
    return { alerts: 0 };
  }
  const candidates = overdue.map((t) => ({
    id: t.id,
    subject: t.subject,
    ageHours: businessHours
      ? businessHoursBetween(businessHours, t.createdAt, now)
      : (now.getTime() - t.createdAt.getTime()) / 3600000,
  }));

  const priorAlerts = await prisma.ticketEvent.findMany({
    where: {
      ticketId: { in: candidates.map((t) => t.id) },
      type: TICKET_EVENT.slaAlert,
    },
    select: { ticketId: true, meta: true },
  });
  const alreadyAlerted = new Set<string>();
  for (const e of priorAlerts) {
    const level = (e.meta as { level?: string } | null)?.level;
    if (level === 'warning' || level === 'breach') {
      alreadyAlerted.add(alertKey(e.ticketId, level as SlaAlertLevel));
    }
  }

  const alerts = computeSlaAlerts(candidates, target, alreadyAlerted);
  if (alerts.length === 0) {
    return { alerts: 0 };
  }

  const config = buildTenantConfig(tenant);
  const { subject, html } = buildSlaAlertEmail(alerts, {
    tenantName: config.displayName,
    language: config.language,
    appBaseUrl: process.env.APP_BASE_URL || null,
  });

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

  // Record the alerts AFTER the email went out — a failed send must not
  // mark tickets as alerted (the next run retries them instead).
  await logTicketEvents(
    prisma,
    alerts.map((a) => ({
      tenantId: tenant.id,
      ticketId: a.ticketId,
      type: TICKET_EVENT.slaAlert,
      actor: EVENT_ACTOR.system,
      meta: { level: a.level },
    }))
  );

  return {
    alerts: alerts.length,
    breaches: alerts.filter((a) => a.level === 'breach').length,
    warnings: alerts.filter((a) => a.level === 'warning').length,
  };
}

export async function GET(request: NextRequest) {
  const authResult = requireCronSecret(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
    const now = new Date();
    const results: Record<string, unknown> = {};
    for (const tenant of tenants) {
      if (!billingState(tenant).active) {
        results[tenant.subdomain] = { skipped: 'subscription inactive' };
        continue;
      }
      try {
        results[tenant.subdomain] = await runSlaCheckForTenant(tenant, now);
      } catch (error) {
        console.error(`Error running SLA check for ${tenant.subdomain}:`, error);
        results[tenant.subdomain] = { error: 'failed' };
      }
    }
    return NextResponse.json({ tenants: results });
  } catch (error) {
    console.error('Error running SLA check:', error);
    return NextResponse.json({ error: 'Failed to run SLA check' }, { status: 500 });
  }
}
