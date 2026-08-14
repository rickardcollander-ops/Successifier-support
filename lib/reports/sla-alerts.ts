// Pure SLA-alert decision logic, separated from the cron route so it's
// unit-testable. Given the open, still-unanswered tickets (the same
// population lib/reports/compute.ts's findOverdueUnanswered returns, fetched
// with the WARNING threshold so approaching tickets are included), the SLA
// target and the set of alerts already sent, decide which alerts to send now.
//
// Levels: 'warning' when a ticket has used ≥ 80% of the first-response
// target without a reply, 'breach' at ≥ 100%. Idempotency: at most ONE
// alert per (ticket, level), ever — enforced by recording each sent alert
// as a TicketEvent of type 'sla_alert' with meta.level, and passing the set
// of already-sent pairs back in here. A ticket that breaches without ever
// having been warned gets only the breach alert (one email is enough).

export const SLA_WARNING_SHARE = 0.8;

export type SlaAlertLevel = 'warning' | 'breach';

// ageHours is precomputed by the caller IN THE ACTIVE BASIS — elapsed open
// hours when öppettider are configured, calendar hours otherwise — so the
// levels here always agree with the SLA panel's overdue list.
export interface SlaAlertCandidate {
  id: string;
  subject: string;
  ageHours: number;
}

export interface SlaAlert {
  ticketId: string;
  subject: string;
  level: SlaAlertLevel;
  ageHours: number;
  targetHours: number;
}

export function alertKey(ticketId: string, level: SlaAlertLevel): string {
  return `${ticketId}:${level}`;
}

export function computeSlaAlerts(
  candidates: SlaAlertCandidate[],
  targetHours: number,
  alreadyAlerted: Set<string>
): SlaAlert[] {
  if (!(targetHours > 0)) return [];
  const alerts: SlaAlert[] = [];
  for (const t of candidates) {
    const level: SlaAlertLevel | null =
      t.ageHours >= targetHours ? 'breach'
      : t.ageHours >= targetHours * SLA_WARNING_SHARE ? 'warning'
      : null;
    if (!level) continue;
    if (alreadyAlerted.has(alertKey(t.id, level))) continue;
    alerts.push({
      ticketId: t.id,
      subject: t.subject,
      level,
      ageHours: Math.round(t.ageHours * 10) / 10,
      targetHours,
    });
  }
  // Breaches first, oldest first — the email should lead with the worst.
  return alerts.sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === 'breach' ? -1 : 1) || b.ageHours - a.ageHours
  );
}

// One batched alert email per cron run — not one per ticket, which would
// drown the inbox exactly when things are going badly.
export function buildSlaAlertEmail(
  alerts: SlaAlert[],
  opts: { tenantName: string; language: 'sv' | 'en'; appBaseUrl?: string | null }
): { subject: string; html: string } {
  const sv = opts.language === 'sv';
  const breaches = alerts.filter((a) => a.level === 'breach');
  const warnings = alerts.filter((a) => a.level === 'warning');

  const subject = sv
    ? `SLA-larm: ${alerts.length} ${alerts.length === 1 ? 'ärende behöver' : 'ärenden behöver'} svar – ${opts.tenantName}`
    : `SLA alert: ${alerts.length} ticket${alerts.length === 1 ? '' : 's'} need${alerts.length === 1 ? 's' : ''} a reply – ${opts.tenantName}`;

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const item = (a: SlaAlert) => {
    const label = esc(a.subject || (sv ? '(utan ämne)' : '(no subject)'));
    const age = `${a.ageHours} h`;
    const link = opts.appBaseUrl
      ? `<a href="${esc(opts.appBaseUrl)}/tickets?ticket=${encodeURIComponent(a.ticketId)}" style="color:#7C5CFF;">${label}</a>`
      : label;
    return `<li style="margin:4px 0;">${link} <span style="color:#94a3b8;font-size:12px;">· ${age} ${sv ? 'utan svar' : 'without a reply'} (${sv ? 'mål' : 'target'} ${a.targetHours} h)</span></li>`;
  };

  const section = (title: string, color: string, list: SlaAlert[]) =>
    list.length === 0
      ? ''
      : `<p style="margin:16px 0 4px;font-weight:600;color:${color};">${esc(title)}</p>
         <ul style="margin:0;padding-left:20px;">${list.map(item).join('')}</ul>`;

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#0f172a;max-width:640px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;margin:0 0 4px;">${esc(sv ? 'SLA-larm' : 'SLA alert')}</h1>
  <p style="margin:0 0 8px;color:#64748b;">${esc(opts.tenantName)}</p>
  ${section(sv ? 'Passerat målet utan svar' : 'Past the target without a reply', '#dc2626', breaches)}
  ${section(sv ? 'Närmar sig målet (≥ 80%)' : 'Approaching the target (≥ 80%)', '#d97706', warnings)}
  <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">${esc(
    sv
      ? 'Varje ärende larmas högst en gång per nivå. Ändra mottagare under Rapporter → Inställningar.'
      : 'Each ticket is alerted at most once per level. Change recipients under Reports → Settings.'
  )}</p>
</div>`;

  return { subject, html };
}
