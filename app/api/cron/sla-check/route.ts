import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { product } from '@/lib/products';
import { requireCronSecret } from '@/lib/cron-auth';
import { decryptCredentials } from '@/lib/integrations/credentials';
import { ResendService } from '@/lib/integrations/resend';
import { findOverdueUnanswered } from '@/lib/reports/compute';
import {
  computeSlaAlerts,
  buildSlaAlertEmail,
  alertKey,
  SLA_WARNING_SHARE,
  type SlaAlertLevel,
} from '@/lib/reports/sla-alerts';
import { TICKET_EVENT, EVENT_ACTOR, logTicketEvents } from '@/lib/services/ticket-events';

// Proactive SLA alerting. Invoked hourly by Vercel Cron (see vercel.json):
// finds open, still-unanswered tickets that have used ≥ 80% of the
// first-response target ('warning') or passed it ('breach') and emails the
// configured recipients ONE batched list. Idempotent: every sent alert is
// recorded as an 'sla_alert' TicketEvent (meta.level), and a (ticket, level)
// pair is never alerted twice — re-running the cron sends nothing new.
// The overdue population is findOverdueUnanswered — the exact query behind
// the reports page's SLA panel — so the alert list and the panel agree.

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
    const target = settings?.slaFirstResponseHours ?? null;
    const recipients = settings?.alertRecipients ?? [];
    if (!settings?.slaAlertsEnabled || target == null || recipients.length === 0) {
      return NextResponse.json({ skipped: 'sla alerts not configured' });
    }

    const now = new Date();
    // Fetch with the WARNING threshold so approaching tickets are included;
    // computeSlaAlerts assigns the level per ticket.
    const candidates = await findOverdueUnanswered(tenant.id, target * SLA_WARNING_SHARE, now);
    if (candidates.length === 0) {
      return NextResponse.json({ alerts: 0 });
    }

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

    const alerts = computeSlaAlerts(candidates, target, alreadyAlerted, now);
    if (alerts.length === 0) {
      return NextResponse.json({ alerts: 0 });
    }

    const { subject, html } = buildSlaAlertEmail(alerts, {
      tenantName: product.displayName,
      language: product.language,
      appBaseUrl: process.env.APP_BASE_URL || null,
    });

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

    return NextResponse.json({
      alerts: alerts.length,
      breaches: alerts.filter((a) => a.level === 'breach').length,
      warnings: alerts.filter((a) => a.level === 'warning').length,
    });
  } catch (error) {
    console.error('Error running SLA check:', error);
    return NextResponse.json({ error: 'Failed to run SLA check' }, { status: 500 });
  }
}
