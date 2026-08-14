import { describe, expect, it } from 'vitest';
import {
  parseBusinessHours,
  isOpen,
  openMask,
  businessHoursBetween,
  type BusinessHours,
} from '@/lib/business-hours';

// Mon–Fri 08–17, weekend closed — the canonical Swedish office-hours config.
const OFFICE: BusinessHours = [
  { open: 8, close: 17 },
  { open: 8, close: 17 },
  { open: 8, close: 17 },
  { open: 8, close: 17 },
  { open: 8, close: 17 },
  null,
  null,
];

// 2026 calendar facts used below: 2026-08-10 is a Monday; DST transitions
// are 2026-03-29 (spring forward) and 2026-10-25 (fall back). Winter is
// CET (UTC+1), summer CEST (UTC+2).

describe('parseBusinessHours', () => {
  it('accepts a valid config and strips extra keys', () => {
    const parsed = parseBusinessHours([
      { open: 8, close: 17, junk: 'x' },
      { open: 9, close: 15 },
      null, null, null, null,
      { open: 10, close: 24 },
    ]);
    expect(parsed).toEqual([
      { open: 8, close: 17 },
      { open: 9, close: 15 },
      null, null, null, null,
      { open: 10, close: 24 },
    ]);
  });

  it('rejects malformed shapes', () => {
    expect(parseBusinessHours(null)).toBeNull();
    expect(parseBusinessHours('8-17')).toBeNull();
    expect(parseBusinessHours([])).toBeNull();
    expect(parseBusinessHours(Array(6).fill(null))).toBeNull();
    expect(parseBusinessHours([{ open: 8, close: 17 }, null, null, null, null, null, null, null])).toBeNull();
    expect(parseBusinessHours([{ open: 17, close: 8 }, ...Array(6).fill(null)])).toBeNull(); // open >= close
    expect(parseBusinessHours([{ open: 8, close: 8 }, ...Array(6).fill(null)])).toBeNull();
    expect(parseBusinessHours([{ open: 8.5, close: 17 }, ...Array(6).fill(null)])).toBeNull(); // non-integer
    expect(parseBusinessHours([{ open: -1, close: 17 }, ...Array(6).fill(null)])).toBeNull();
    expect(parseBusinessHours([{ open: 8, close: 25 }, ...Array(6).fill(null)])).toBeNull();
    expect(parseBusinessHours([{ open: 8 }, ...Array(6).fill(null)])).toBeNull();
  });

  it('collapses an all-closed week to null (= not configured)', () => {
    expect(parseBusinessHours(Array(7).fill(null))).toBeNull();
  });
});

describe('isOpen / openMask', () => {
  it('treats close as exclusive', () => {
    expect(isOpen(OFFICE, 0, 8)).toBe(true);
    expect(isOpen(OFFICE, 0, 16)).toBe(true);
    expect(isOpen(OFFICE, 0, 17)).toBe(false);
    expect(isOpen(OFFICE, 0, 7)).toBe(false);
    expect(isOpen(OFFICE, 5, 12)).toBe(false); // Saturday closed
  });

  it('builds the 7×24 mask matching isOpen', () => {
    const mask = openMask(OFFICE);
    expect(mask[0][8]).toBe(true);
    expect(mask[0][17]).toBe(false);
    expect(mask[4][16]).toBe(true);
    expect(mask[5].every((v) => v === false)).toBe(true);
    expect(mask[6].every((v) => v === false)).toBe(true);
  });
});

describe('businessHoursBetween', () => {
  // Helper: an instant at Stockholm wall time on a date (CET/CEST offset
  // passed explicitly so the test states its expectation).
  const at = (iso: string) => new Date(iso);

  it('counts a same-day partial span, clamped at open', () => {
    // Wednesday 2026-08-12, CEST (UTC+2): 10:00–14:30 local = 4.5 open hours.
    expect(businessHoursBetween(OFFICE, at('2026-08-12T08:00:00Z'), at('2026-08-12T12:30:00Z'))).toBeCloseTo(4.5);
    // 06:00–10:00 local → clamped at 08 open → 2 hours.
    expect(businessHoursBetween(OFFICE, at('2026-08-12T04:00:00Z'), at('2026-08-12T08:00:00Z'))).toBeCloseTo(2);
  });

  it('pauses over a closed weekend: Friday 18:00 → Monday 09:00 = 1.0', () => {
    // Friday 2026-08-07 18:00 CEST = 16:00Z; Monday 2026-08-10 09:00 CEST = 07:00Z.
    expect(businessHoursBetween(OFFICE, at('2026-08-07T16:00:00Z'), at('2026-08-10T07:00:00Z'))).toBeCloseTo(1);
  });

  it('returns 0 for spans entirely inside closed time', () => {
    // Saturday 10:00 → Sunday 15:00 (2026-08-08/09).
    expect(businessHoursBetween(OFFICE, at('2026-08-08T08:00:00Z'), at('2026-08-09T13:00:00Z'))).toBe(0);
    // Friday evening answered before Monday open → 0 (SLA counts this as met).
    expect(businessHoursBetween(OFFICE, at('2026-08-07T16:00:00Z'), at('2026-08-10T05:00:00Z'))).toBe(0);
  });

  it('handles both 2026 DST transitions: Fri 16:00 → Mon 09:00 = 2.0', () => {
    // Spring forward weekend (transition 2026-03-29): Fri 2026-03-27 16:00
    // CET = 15:00Z → Mon 2026-03-30 09:00 CEST = 07:00Z. Open hours:
    // Fri 16–17 (1h) + Mon 8–9 (1h).
    expect(businessHoursBetween(OFFICE, at('2026-03-27T15:00:00Z'), at('2026-03-30T07:00:00Z'))).toBeCloseTo(2);
    // Fall back weekend (transition 2026-10-25): Fri 2026-10-23 16:00 CEST
    // = 14:00Z → Mon 2026-10-26 09:00 CET = 08:00Z.
    expect(businessHoursBetween(OFFICE, at('2026-10-23T14:00:00Z'), at('2026-10-26T08:00:00Z'))).toBeCloseTo(2);
  });

  it('counts elapsed real hours when the open window contains the transition', () => {
    // Sunday 2026-03-29 open 0–6: wall clock 00:00→06:00 spans the missing
    // 02:00–03:00 hour, so only 5 real hours elapse.
    const sundayOpen: BusinessHours = [null, null, null, null, null, null, { open: 0, close: 6 }];
    // 00:00 CET = 2026-03-28T23:00Z; 06:00 CEST = 2026-03-29T04:00Z.
    expect(businessHoursBetween(sundayOpen, at('2026-03-28T23:00:00Z'), at('2026-03-29T04:00:00Z'))).toBeCloseTo(5);
  });

  it('returns 0 when to <= from and sums multi-week spans', () => {
    expect(businessHoursBetween(OFFICE, at('2026-08-12T12:00:00Z'), at('2026-08-12T12:00:00Z'))).toBe(0);
    expect(businessHoursBetween(OFFICE, at('2026-08-12T12:00:00Z'), at('2026-08-11T12:00:00Z'))).toBe(0);
    // Two full weeks = 10 workdays × 9h = 90h. Monday 00:00 → Monday 00:00
    // (2026-08-10 → 2026-08-24, CEST: 22:00Z previous day).
    expect(businessHoursBetween(OFFICE, at('2026-08-09T22:00:00Z'), at('2026-08-23T22:00:00Z'))).toBeCloseTo(90);
  });

  it('handles close = 24 (open until midnight)', () => {
    const lateMonday: BusinessHours = [{ open: 20, close: 24 }, null, null, null, null, null, null];
    // Monday 2026-08-10 19:00 → Tuesday 01:00 local (17:00Z → 23:00Z) → 4h.
    expect(businessHoursBetween(lateMonday, at('2026-08-10T17:00:00Z'), at('2026-08-10T23:00:00Z'))).toBeCloseTo(4);
  });
});
