import { describe, expect, it } from 'vitest';
import {
  computeSlaAlerts,
  buildSlaAlertEmail,
  alertKey,
  SLA_WARNING_SHARE,
} from '@/lib/reports/sla-alerts';

const NOW = new Date('2026-08-14T10:00:00Z');
const HOUR = 3600 * 1000;
// A ticket created `age` hours before NOW.
const ticket = (id: string, ageHours: number, subject = `Ärende ${id}`) => ({
  id,
  subject,
  createdAt: new Date(NOW.getTime() - ageHours * HOUR),
});

describe('computeSlaAlerts', () => {
  // 20h target → warning threshold exactly 16h (exact in floating point).
  const TARGET = 20;

  it('assigns warning at 80% and breach at 100% of the target', () => {
    const alerts = computeSlaAlerts(
      [ticket('fresh', 15.5), ticket('warn', 16), ticket('breach', 20)],
      TARGET,
      new Set(),
      NOW
    );
    // 15.5h < 16h (80% of 20) → no alert; exactly at thresholds → alert.
    expect(alerts.map((a) => `${a.ticketId}:${a.level}`)).toEqual([
      'breach:breach',
      'warn:warning',
    ]);
    expect(SLA_WARNING_SHARE).toBe(0.8);
  });

  it('never alerts the same (ticket, level) twice', () => {
    const already = new Set([alertKey('warn', 'warning'), alertKey('gone', 'breach')]);
    const alerts = computeSlaAlerts(
      [ticket('warn', 17), ticket('gone', 30)],
      TARGET,
      already,
      NOW
    );
    expect(alerts).toEqual([]);
  });

  it('escalates a warned ticket to breach exactly once', () => {
    const already = new Set([alertKey('t1', 'warning')]);
    const alerts = computeSlaAlerts([ticket('t1', 25)], TARGET, already, NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('breach');
  });

  it('returns nothing without a positive target', () => {
    expect(computeSlaAlerts([ticket('t1', 100)], 0, new Set(), NOW)).toEqual([]);
  });

  it('sorts breaches before warnings, oldest first', () => {
    const alerts = computeSlaAlerts(
      [ticket('w', 17), ticket('b1', 25), ticket('b2', 40)],
      TARGET,
      new Set(),
      NOW
    );
    expect(alerts.map((a) => a.ticketId)).toEqual(['b2', 'b1', 'w']);
  });
});

describe('buildSlaAlertEmail', () => {
  it('renders links when a base URL is configured, plain text otherwise', () => {
    const alerts = computeSlaAlerts([ticket('t1', 30, 'Uppsägning')], 24, new Set(), NOW);
    const withLink = buildSlaAlertEmail(alerts, {
      tenantName: 'Doldadress',
      language: 'sv',
      appBaseUrl: 'https://app.example.com',
    });
    expect(withLink.subject).toContain('SLA-larm');
    expect(withLink.html).toContain('https://app.example.com/tickets?ticket=t1');
    expect(withLink.html).toContain('Uppsägning');

    const withoutLink = buildSlaAlertEmail(alerts, {
      tenantName: 'Doldadress',
      language: 'sv',
      appBaseUrl: null,
    });
    expect(withoutLink.html).not.toContain('<a href');
  });

  it('escapes HTML in ticket subjects', () => {
    const alerts = computeSlaAlerts(
      [ticket('t1', 30, '<script>alert(1)</script>')],
      24,
      new Set(),
      NOW
    );
    const { html } = buildSlaAlertEmail(alerts, {
      tenantName: 'Doldadress',
      language: 'sv',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
