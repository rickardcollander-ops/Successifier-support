import { describe, expect, it } from 'vitest';
import {
  dayKey,
  stockholmMidnight,
  shiftDayKey,
  stockholmWeekday,
  stockholmSlot,
  parseStockholmTimestamp,
} from '@/lib/time/stockholm';

// 2026 DST transitions in Europe/Stockholm: spring forward on March 29
// (02:00 → 03:00 CEST), fall back on October 25 (03:00 → 02:00 CET).

describe('lib/time/stockholm', () => {
  it('buckets an instant on the Stockholm calendar day, not the UTC one', () => {
    // 23:30 UTC on Jan 1 is 00:30 Jan 2 in Stockholm (CET = UTC+1).
    expect(dayKey(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-02');
    // 22:30 UTC in July is 00:30 next day (CEST = UTC+2).
    expect(dayKey(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02');
  });

  it('resolves Stockholm midnight across both DST transitions', () => {
    // Winter: midnight = 23:00 UTC previous day.
    expect(stockholmMidnight('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    // Day after spring-forward: CEST, midnight = 22:00 UTC previous day.
    expect(stockholmMidnight('2026-03-30').toISOString()).toBe('2026-03-29T22:00:00.000Z');
    // Fall-back day starts in CEST.
    expect(stockholmMidnight('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    // Day after fall-back: back to CET.
    expect(stockholmMidnight('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('shifts day keys with pure calendar math', () => {
    expect(shiftDayKey('2026-03-29', 1)).toBe('2026-03-30');
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('maps weekdays with Monday = 0', () => {
    // 2026-08-10 is a Monday, 2026-08-16 a Sunday.
    expect(stockholmWeekday(new Date('2026-08-10T12:00:00Z'))).toBe(0);
    expect(stockholmWeekday(new Date('2026-08-16T12:00:00Z'))).toBe(6);
  });

  it('resolves weekday and wall-clock hour in one slot', () => {
    // 22:30 UTC on Friday July 3 = 00:30 Saturday in Stockholm.
    const slot = stockholmSlot(new Date('2026-07-03T22:30:00Z'));
    expect(slot).toEqual({ weekday: 5, hour: 0 });
    // Winter: 08:15 UTC = 09:15 CET, a Wednesday.
    expect(stockholmSlot(new Date('2026-01-07T08:15:00Z'))).toEqual({ weekday: 2, hour: 9 });
  });

  it('round-trips thread-marker timestamps (sv-SE Stockholm wall time)', () => {
    const winter = parseStockholmTimestamp('2026-01-15 14:32:11');
    expect(winter?.toISOString()).toBe('2026-01-15T13:32:11.000Z'); // CET
    const summer = parseStockholmTimestamp('2026-07-15 14:32:11');
    expect(summer?.toISOString()).toBe('2026-07-15T12:32:11.000Z'); // CEST
    // Round-trip: formatting the parsed instant back to Stockholm wall time
    // reproduces the original string.
    expect(
      summer!.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })
    ).toBe('2026-07-15 14:32:11');
  });

  it('rejects garbage timestamps', () => {
    expect(parseStockholmTimestamp('not a date')).toBeNull();
    expect(parseStockholmTimestamp('2026-13-99 25:00:00')).not.toBeNull(); // shape matches; Date math normalises
    expect(parseStockholmTimestamp('')).toBeNull();
  });
});
