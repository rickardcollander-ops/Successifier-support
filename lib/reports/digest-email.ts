import type { KpiSummary } from '@/lib/reports/compute';

// Pure HTML builder for the scheduled report digest — separated from the
// cron route so it's unit-testable. Same philosophy as the reports page:
// never invent a number. Metrics without data render '–', and deltas are
// only claimed when both periods carry a workable sample.

const MIN_DELTA_SAMPLE = 15;

export interface DigestOptions {
  tenantName: string;
  language: 'sv' | 'en';
  // Human label for the covered period, e.g. "11–17 aug 2026".
  periodLabel: string;
  // Base URL of the app (no trailing slash) for the "open reports" link;
  // omitted → no link rendered.
  appBaseUrl?: string | null;
  // Current number of open tickets past the SLA target without a reply.
  overdueCount?: number | null;
}

const STRINGS = {
  sv: {
    subject: (period: string, tenant: string) => `Kundtjänstrapport ${period} – ${tenant}`,
    heading: (period: string) => `Kundtjänstrapport ${period}`,
    metric: 'Nyckeltal',
    value: 'Värde',
    previous: 'Föregående period',
    totalTickets: 'Inkomna ärenden',
    totalSent: 'Skickade svar',
    medianResponse: 'Median svarstid',
    firstResponse: 'Första svarstid (median)',
    activeWork: 'Aktiv arbetstid per ärende (median)',
    aiKept: 'Andel av svaren från AI-utkastet (median)',
    csat: 'Kundnöjdhet (andel 👍)',
    slaAttainment: 'SLA-uppfyllnad',
    overdue: (n: number) =>
      n === 1
        ? '1 öppet ärende har passerat SLA-målet utan svar.'
        : `${n} öppna ärenden har passerat SLA-målet utan svar.`,
    noOverdue: 'Inga öppna ärenden har passerat SLA-målet utan svar.',
    openReports: 'Öppna rapporterna',
    footer: 'Det här är en automatisk rapport. Ändra mottagare eller frekvens under Rapporter → Inställningar.',
    hours: 'h',
    minutes: 'min',
  },
  en: {
    subject: (period: string, tenant: string) => `Support report ${period} – ${tenant}`,
    heading: (period: string) => `Support report ${period}`,
    metric: 'Key metric',
    value: 'Value',
    previous: 'Previous period',
    totalTickets: 'Tickets received',
    totalSent: 'Replies sent',
    medianResponse: 'Median response time',
    firstResponse: 'First response time (median)',
    activeWork: 'Active work per ticket (median)',
    aiKept: 'Share of replies from the AI draft (median)',
    csat: 'Customer satisfaction (👍 share)',
    slaAttainment: 'SLA attainment',
    overdue: (n: number) =>
      n === 1
        ? '1 open ticket has passed the SLA target without a reply.'
        : `${n} open tickets have passed the SLA target without a reply.`,
    noOverdue: 'No open tickets have passed the SLA target without a reply.',
    openReports: 'Open the reports',
    footer: 'This is an automated report. Change recipients or frequency under Reports → Settings.',
    hours: 'h',
    minutes: 'min',
  },
} as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Delta cell: "+12%" / "−8%", green when better. Only claimed when both
// periods have enough underlying tickets; otherwise empty.
function deltaHtml(
  current: number,
  previous: number,
  currentN: number,
  previousN: number,
  lowerIsBetter: boolean
): string {
  if (currentN < MIN_DELTA_SAMPLE || previousN < MIN_DELTA_SAMPLE || previous <= 0) return '';
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return '';
  const better = lowerIsBetter ? current < previous : current > previous;
  const color = better ? '#059669' : '#dc2626';
  return ` <span style="color:${color};font-size:12px;">(${pct > 0 ? '+' : ''}${pct}%)</span>`;
}

export function buildDigestEmail(
  summary: KpiSummary,
  previous: KpiSummary,
  opts: DigestOptions
): { subject: string; html: string } {
  const s = STRINGS[opts.language];
  const dash = '–';

  type Row = { label: string; value: string; prev: string; delta: string };
  const rows: Row[] = [
    {
      label: s.totalTickets,
      value: String(summary.totalTickets),
      prev: String(previous.totalTickets),
      delta: '',
    },
    {
      label: s.totalSent,
      value: String(summary.totalSent),
      prev: String(previous.totalSent),
      delta: '',
    },
    {
      label: s.medianResponse,
      value: summary.totalSent > 0 ? `${summary.medianResponseHours} ${s.hours}` : dash,
      prev: previous.totalSent > 0 ? `${previous.medianResponseHours} ${s.hours}` : dash,
      delta: deltaHtml(
        summary.medianResponseHours,
        previous.medianResponseHours,
        summary.totalSent,
        previous.totalSent,
        true
      ),
    },
    {
      label: s.firstResponse,
      value: summary.firstResponse.count > 0 ? `${summary.firstResponse.medianHours} ${s.hours}` : dash,
      prev: previous.firstResponse.count > 0 ? `${previous.firstResponse.medianHours} ${s.hours}` : dash,
      delta: deltaHtml(
        summary.firstResponse.medianHours,
        previous.firstResponse.medianHours,
        summary.firstResponse.count,
        previous.firstResponse.count,
        true
      ),
    },
    {
      label: s.activeWork,
      value: summary.activeWork.count > 0 ? `${summary.activeWork.medianMinutes} ${s.minutes}` : dash,
      prev: previous.activeWork.count > 0 ? `${previous.activeWork.medianMinutes} ${s.minutes}` : dash,
      delta: deltaHtml(
        summary.activeWork.medianMinutes,
        previous.activeWork.medianMinutes,
        summary.activeWork.count,
        previous.activeWork.count,
        true
      ),
    },
    {
      label: s.aiKept,
      value: summary.editStats.count > 0 ? `${summary.editStats.medianKeptPct}%` : dash,
      prev: previous.editStats.count > 0 ? `${previous.editStats.medianKeptPct}%` : dash,
      delta: deltaHtml(
        summary.editStats.medianKeptPct,
        previous.editStats.medianKeptPct,
        summary.editStats.count,
        previous.editStats.count,
        false
      ),
    },
  ];
  if (summary.csat.count > 0 || previous.csat.count > 0) {
    rows.push({
      label: s.csat,
      value: summary.csat.sharePct != null ? `${summary.csat.sharePct}%` : `${summary.csat.positive}/${summary.csat.count}`,
      prev: previous.csat.sharePct != null ? `${previous.csat.sharePct}%` : previous.csat.count > 0 ? `${previous.csat.positive}/${previous.csat.count}` : dash,
      delta:
        summary.csat.sharePct != null && previous.csat.sharePct != null
          ? deltaHtml(summary.csat.sharePct, previous.csat.sharePct, summary.csat.count, previous.csat.count, false)
          : '',
    });
  }
  if (summary.sla) {
    rows.push({
      label: `${s.slaAttainment} (≤ ${summary.sla.targetHours} ${s.hours})`,
      value: summary.sla.attainmentPct != null ? `${summary.sla.attainmentPct}%` : dash,
      prev: previous.sla?.attainmentPct != null ? `${previous.sla.attainmentPct}%` : dash,
      delta:
        summary.sla.attainmentPct != null && previous.sla?.attainmentPct != null
          ? deltaHtml(
              summary.sla.attainmentPct,
              previous.sla.attainmentPct,
              summary.sla.answered,
              previous.sla.answered,
              false
            )
          : '',
    });
  }

  const tableRows = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;">${esc(r.label)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${r.value}${r.delta}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#94a3b8;">${r.prev}</td>
      </tr>`
    )
    .join('');

  const topCategoriesLine =
    summary.topCategories.length === 0
      ? ''
      : `<p style="margin:16px 0 0;color:#475569;">${esc(
          opts.language === 'sv' ? 'Vanligaste ämnen:' : 'Top topics:'
        )} ${summary.topCategories
          .map((c) => `${esc(c.category)} (${c.count})`)
          .join(', ')}</p>`;

  const overdueLine =
    summary.sla == null || opts.overdueCount == null
      ? ''
      : opts.overdueCount > 0
        ? `<p style="margin:16px 0 0;color:#dc2626;font-weight:600;">${esc(s.overdue(opts.overdueCount))}</p>`
        : `<p style="margin:16px 0 0;color:#059669;">${esc(s.noOverdue)}</p>`;

  const reportsLink = opts.appBaseUrl
    ? `<p style="margin:20px 0 0;"><a href="${esc(opts.appBaseUrl)}/reports" style="color:#7C5CFF;font-weight:600;">${esc(s.openReports)} →</a></p>`
    : '';

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#0f172a;max-width:640px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;margin:0 0 4px;">${esc(s.heading(opts.periodLabel))}</h1>
  <p style="margin:0 0 16px;color:#64748b;">${esc(opts.tenantName)}</p>
  <table style="border-collapse:collapse;width:100%;">
    <thead>
      <tr>
        <th align="left" style="padding:8px 12px;border-bottom:2px solid #cbd5e1;color:#64748b;font-size:12px;text-transform:uppercase;">${esc(s.metric)}</th>
        <th align="left" style="padding:8px 12px;border-bottom:2px solid #cbd5e1;color:#64748b;font-size:12px;text-transform:uppercase;">${esc(s.value)}</th>
        <th align="left" style="padding:8px 12px;border-bottom:2px solid #cbd5e1;color:#64748b;font-size:12px;text-transform:uppercase;">${esc(s.previous)}</th>
      </tr>
    </thead>
    <tbody>${tableRows}
    </tbody>
  </table>
  ${topCategoriesLine}
  ${overdueLine}
  ${reportsLink}
  <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">${esc(s.footer)}</p>
</div>`;

  return {
    subject: s.subject(opts.periodLabel, opts.tenantName),
    html,
  };
}
