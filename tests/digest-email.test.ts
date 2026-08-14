import { describe, expect, it } from 'vitest';
import { buildDigestEmail } from '@/lib/reports/digest-email';
import type { KpiSummary } from '@/lib/reports/compute';

const summary = (over: Partial<KpiSummary> = {}): KpiSummary => ({
  from: '2026-08-03T00:00:00.000Z',
  to: '2026-08-10T00:00:00.000Z',
  totalTickets: 120,
  totalSent: 100,
  medianResponseHours: 4,
  firstResponse: { count: 90, medianHours: 3, p90Hours: 20 },
  activeWork: { count: 60, medianMinutes: 5 },
  editStats: { count: 80, medianKeptPct: 85 },
  sla: { targetHours: 24, answered: 90, met: 81, attainmentPct: 90 },
  topCategories: [
    { category: 'uppsägning', count: 30 },
    { category: 'faktura & betalning', count: 20 },
  ],
  ...over,
});

const OPTS = {
  tenantName: 'Doldadress',
  language: 'sv' as const,
  periodLabel: '3 aug – 9 aug 2026',
  appBaseUrl: 'https://app.example.com',
  overdueCount: 2,
};

describe('buildDigestEmail', () => {
  it('renders the right numbers with deltas against the previous period', () => {
    const { subject, html } = buildDigestEmail(
      summary(),
      summary({ medianResponseHours: 5, totalTickets: 100 }),
      OPTS
    );
    expect(subject).toBe('Kundtjänstrapport 3 aug – 9 aug 2026 – Doldadress');
    expect(html).toContain('120'); // current tickets
    expect(html).toContain('4 h'); // current median
    expect(html).toContain('5 h'); // previous median
    expect(html).toContain('(-20%)'); // 4 vs 5, lower is better
    expect(html).toContain('90%'); // SLA attainment
    expect(html).toContain('2 öppna ärenden har passerat SLA-målet utan svar.');
    expect(html).toContain('Vanligaste ämnen:');
    expect(html).toContain('uppsägning (30)');
    expect(html).toContain('https://app.example.com/reports');
  });

  it('never invents numbers: empty periods render dashes, no deltas', () => {
    const empty = summary({
      totalTickets: 0,
      totalSent: 0,
      medianResponseHours: 0,
      firstResponse: { count: 0, medianHours: 0, p90Hours: 0 },
      activeWork: { count: 0, medianMinutes: 0 },
      editStats: { count: 0, medianKeptPct: 0 },
      sla: null,
      topCategories: [],
    });
    const { html } = buildDigestEmail(empty, empty, { ...OPTS, overdueCount: null });
    expect(html).toContain('–');
    expect(html).not.toContain('%)'); // no delta badges anywhere
    expect(html).not.toContain('SLA');
  });

  it('suppresses deltas below the sample floor', () => {
    const { html } = buildDigestEmail(
      summary({ totalSent: 10 }), // below MIN_DELTA_SAMPLE
      summary({ medianResponseHours: 8 }),
      OPTS
    );
    // Median row shows both values but claims no percentage.
    expect(html).toContain('4 h');
    expect(html).toContain('8 h');
    expect(html).not.toContain('(-50%)');
  });

  it('renders in English for en-language products', () => {
    const { subject, html } = buildDigestEmail(summary(), summary(), {
      ...OPTS,
      language: 'en',
      tenantName: 'Serus',
      overdueCount: 0,
    });
    expect(subject).toContain('Support report');
    expect(html).toContain('Replies sent');
    expect(html).toContain('No open tickets have passed the SLA target');
  });
});
