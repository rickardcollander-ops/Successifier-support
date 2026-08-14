import { describe, expect, it } from 'vitest';
import {
  median,
  percentile,
  orderedCounts,
  validateFilters,
  previousReportWindow,
} from '@/lib/reports/compute';
import { resolveReportWindow } from '@/lib/report-window';

// Fixed "now": Friday 2026-08-14 12:00 Stockholm (CEST = UTC+2).
const NOW = new Date('2026-08-14T10:00:00Z');

describe('median / percentile', () => {
  it('returns 0 for empty input', () => {
    expect(median([])).toBe(0);
    expect(percentile([], 90)).toBe(0);
  });

  it('computes odd- and even-length medians without mutating input', () => {
    const values = [5, 1, 3];
    expect(median(values)).toBe(3);
    expect(values).toEqual([5, 1, 3]); // sort must copy
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('computes nearest-rank p90', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(ten, 90)).toBe(9);
    expect(percentile([7], 90)).toBe(7);
  });
});

describe('orderedCounts', () => {
  it('orders known keys canonically and appends unknown ones', () => {
    const counts = orderedCounts(
      ['low', 'urgent', 'weird', 'low', 'urgent', 'urgent'],
      ['urgent', 'high', 'normal', 'low']
    );
    expect(Object.keys(counts)).toEqual(['urgent', 'low', 'weird']);
    expect(counts).toEqual({ urgent: 3, low: 2, weird: 1 });
  });
});

describe('validateFilters', () => {
  it('accepts known values and degrades garbage to no filter', () => {
    expect(validateFilters({ status: 'new', priority: 'high' })).toMatchObject({
      status: 'new',
      priority: 'high',
    });
    expect(validateFilters({ status: 'nope', priority: 'DROP TABLE' })).toMatchObject({
      status: null,
      priority: null,
    });
  });

  it('resolves agent aliases through resolveAgentName', () => {
    // Unknown names → null (no filter) instead of an empty report.
    expect(validateFilters({ agent: 'someone@else.com' }).agent).toBeNull();
  });
});

describe('previousReportWindow', () => {
  const prevFor = (range: string, from: string | null = null, to: string | null = null) => {
    const win = resolveReportWindow(range, from, to, NOW);
    return { win, prev: previousReportWindow(range, win, NOW) };
  };

  it('1d: the 24 hours before the rolling 24h window', () => {
    const { win, prev } = prevFor('1d');
    expect(prev.windowEnd.getTime()).toBe(win.windowStart.getTime());
    expect(prev.windowEnd.getTime() - prev.windowStart.getTime()).toBe(24 * 3600 * 1000);
  });

  it('lastWeek: the full week before', () => {
    const { win, prev } = prevFor('lastWeek');
    // lastWeek = Mon Aug 3 → Mon Aug 10; previous = Mon Jul 27 → Mon Aug 3.
    expect(win.windowStart.toISOString()).toBe('2026-08-02T22:00:00.000Z');
    expect(prev.windowStart.toISOString()).toBe('2026-07-26T22:00:00.000Z');
    expect(prev.windowEnd.getTime()).toBe(win.windowStart.getTime());
  });

  it('thisWeek: same elapsed portion of the previous week', () => {
    const { win, prev } = prevFor('thisWeek');
    // This week started Mon Aug 10; by Friday noon 4.5 days have elapsed.
    // The comparison covers Mon Aug 3 → Fri Aug 7 noon, not the whole week.
    expect(prev.windowStart.toISOString()).toBe('2026-08-02T22:00:00.000Z');
    expect(prev.windowEnd.getTime() - prev.windowStart.getTime()).toBe(
      win.windowEnd.getTime() - win.windowStart.getTime()
    );
    expect(prev.windowEnd.getTime()).toBeLessThanOrEqual(win.windowStart.getTime());
  });

  it('thisMonth: same elapsed portion of the previous month', () => {
    const { win, prev } = prevFor('thisMonth');
    expect(win.windowStart.toISOString()).toBe('2026-07-31T22:00:00.000Z');
    expect(prev.windowStart.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    // 13.5 days into August compares against 13.5 days into July.
    expect(prev.windowEnd.toISOString()).toBe('2026-07-14T10:00:00.000Z');
  });

  it('lastMonth: the month before last, in full', () => {
    const { win, prev } = prevFor('lastMonth');
    expect(win.windowStart.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(prev.windowStart.toISOString()).toBe('2026-05-31T22:00:00.000Z');
    expect(prev.windowEnd.getTime()).toBe(win.windowStart.getTime());
  });

  it('rolling 30d: the 30 calendar days before, same elapsed length', () => {
    const { win, prev } = prevFor('30d');
    expect(win.windowStart.toISOString()).toBe('2026-07-15T22:00:00.000Z');
    expect(prev.windowStart.toISOString()).toBe('2026-06-15T22:00:00.000Z');
    expect(prev.windowEnd.getTime() - prev.windowStart.getTime()).toBe(
      win.windowEnd.getTime() - win.windowStart.getTime()
    );
  });

  it('custom: the same number of days immediately before', () => {
    const { win, prev } = prevFor('custom', '2026-08-01', '2026-08-07');
    expect(prev.windowStart.toISOString()).toBe('2026-07-24T22:00:00.000Z');
    expect(prev.windowEnd.getTime()).toBe(win.windowStart.getTime());
  });

  it('never overlaps the current window', () => {
    for (const range of ['1d', '7d', '30d', '90d', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth']) {
      const { win, prev } = prevFor(range);
      expect(prev.windowEnd.getTime()).toBeLessThanOrEqual(win.windowStart.getTime());
      expect(prev.windowStart.getTime()).toBeLessThan(prev.windowEnd.getTime());
    }
  });
});
