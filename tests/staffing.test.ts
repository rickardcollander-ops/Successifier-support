import { describe, expect, it } from 'vitest';
import {
  buildArrivalProfile,
  requiredAgentsGrid,
  actualHoursGrid,
  weekdaySummary,
} from '@/lib/staffing';

const flatProfile = (perHour: number): number[][] =>
  Array.from({ length: 7 }, () => Array(24).fill(perHour));

describe('buildArrivalProfile', () => {
  it('averages arrivals per slot over the observed weeks', () => {
    // 8 tickets on Monday 09 over 4 weeks → 2/week in that slot.
    const arrivals = Array.from({ length: 8 }, () => ({ weekday: 0, hour: 9 }));
    const profile = buildArrivalProfile(arrivals, 4);
    expect(profile[0][9]).toBe(2);
    expect(profile[0][10]).toBe(0);
    expect(profile[6][23]).toBe(0);
  });

  it('ignores out-of-range slots instead of crashing', () => {
    const profile = buildArrivalProfile([{ weekday: -1, hour: 30 }], 1);
    expect(profile.flat().every((c) => c === 0)).toBe(true);
  });
});

describe('requiredAgentsGrid', () => {
  it('applies the workload formula: volume × AHT / effective capacity, ceiled', () => {
    // 6 tickets/h × 12 min = 1.2 agent-hours; ÷ (0.8 × 0.9 = 0.72) = 1.67 → 2.
    const { raw } = requiredAgentsGrid(flatProfile(6), 12, {
      occupancy: 0.8,
      shrinkage: 0.1,
      smoothingHours: 1,
    });
    expect(raw[0][9]).toBe(2);
  });

  it('needs no agents in empty hours', () => {
    const profile = flatProfile(0);
    profile[0][9] = 6;
    const { raw } = requiredAgentsGrid(profile, 12, {
      occupancy: 0.8,
      shrinkage: 0.1,
      smoothingHours: 1,
    });
    expect(raw[0][9]).toBe(2);
    expect(raw[0][10]).toBe(0);
    expect(raw[3][12]).toBe(0);
  });

  it('smoothing spreads a spike over the SLA window instead of demanding a peak', () => {
    // One spike hour of 6 tickets; the following hours absorb it.
    const profile = flatProfile(0);
    profile[0][9] = 6; // 1.2 agent-hours of work
    const { raw, smoothed } = requiredAgentsGrid(profile, 12, {
      occupancy: 0.8,
      shrinkage: 0.1,
      smoothingHours: 3,
    });
    expect(raw[0][9]).toBe(2); // unsmoothed demands 2 at the spike
    expect(smoothed[0][9]).toBe(1); // averaged over 3h: 0.4/0.72 → 1
    expect(smoothed[0][10]).toBe(1); // trailing window still covers the spike
    expect(smoothed[0][11]).toBe(1);
    expect(smoothed[0][12]).toBe(0); // outside the window
  });

  it('smoothing window wraps across weekday boundaries', () => {
    const profile = flatProfile(0);
    profile[0][23] = 6; // Monday 23:00 spike
    const { smoothed } = requiredAgentsGrid(profile, 12, {
      occupancy: 0.8,
      shrinkage: 0.1,
      smoothingHours: 2,
    });
    expect(smoothed[1][0]).toBeGreaterThan(0); // Tuesday 00 absorbs part of it
  });
});

describe('actualHoursGrid', () => {
  it('splits a session across hour boundaries proportionally', () => {
    // 10:30–12:30 UTC on Wed 2026-01-07 = 11:30–13:30 Stockholm (CET):
    // 0.5h in slot 11, 1h in slot 12, 0.5h in slot 13.
    const grid = actualHoursGrid(
      [{ startedAt: new Date('2026-01-07T10:30:00Z'), lastSeenAt: new Date('2026-01-07T12:30:00Z') }],
      1
    );
    expect(grid[2][11]).toBeCloseTo(0.5);
    expect(grid[2][12]).toBeCloseTo(1);
    expect(grid[2][13]).toBeCloseTo(0.5);
    expect(grid[2][14]).toBe(0);
  });

  it('normalises by observed weeks', () => {
    const grid = actualHoursGrid(
      [{ startedAt: new Date('2026-01-07T10:00:00Z'), lastSeenAt: new Date('2026-01-07T11:00:00Z') }],
      2
    );
    expect(grid[2][11]).toBeCloseTo(0.5); // 1h over 2 weeks
  });
});

describe('weekdaySummary', () => {
  it('reports peak concurrent agents and total agent-hours per weekday', () => {
    const grid = flatProfile(0);
    grid[0][9] = 2;
    grid[0][10] = 3;
    grid[0][11] = 1;
    const summary = weekdaySummary(grid);
    expect(summary[0]).toEqual({ weekday: 0, peakAgents: 3, agentHours: 6 });
    expect(summary[6]).toEqual({ weekday: 6, peakAgents: 0, agentHours: 0 });
  });
});
