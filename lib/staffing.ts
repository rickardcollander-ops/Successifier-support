import { stockholmSlot } from '@/lib/time/stockholm';

// Staffing (bemanning) math for an EMAIL support team. Erlang C — the
// classic call-center model — assumes contacts must be answered the moment
// they arrive; email defers, a ticket can wait inside the SLA window. So we
// size on workload instead:
//
//   workloadAgentHours(slot) = forecastVolume(slot) × ahtMinutes / 60
//   requiredAgents(slot)     = ceil( workloadAgentHours(slot)
//                                    / (occupancy × (1 − shrinkage)) )
//
// occupancy = share of a rostered hour an agent realistically spends on
// tickets (context switches, no perfectly packed queue); shrinkage = share
// of rostered time lost to breaks/meetings/absence. Defaults 0.80 / 0.10
// → 0.72 effective agent-hours per rostered hour.
//
// The smoothed variant averages workload over a sliding window of
// `smoothingHours` before rounding up — a single spike hour shouldn't
// demand a whole extra person when the SLA allows the spike to drain over
// the following hours.
//
// Everything here is pure (no prisma, no clock) so it can be unit-tested.

export const DEFAULT_OCCUPANCY = 0.8;
export const DEFAULT_SHRINKAGE = 0.1;

export interface StaffingOptions {
  occupancy: number; // (0, 1)
  shrinkage: number; // [0, 1)
  smoothingHours: number; // >= 1; 1 = no smoothing
}

export interface Slot {
  weekday: number; // Monday = 0 … Sunday = 6
  hour: number; // 0–23, Stockholm wall clock
}

const emptyGrid = (): number[][] => Array.from({ length: 7 }, () => Array(24).fill(0));

// Average arrivals per weekday × hour slot per observed week. Callers pass
// Stockholm slots (stockholmSlot(t.createdAt)) so the grid matches wall
// clock — which is what a staffing schedule is written in.
export function buildArrivalProfile(arrivals: Slot[], weeksObserved: number): number[][] {
  const grid = emptyGrid();
  for (const a of arrivals) {
    if (a.weekday >= 0 && a.weekday < 7 && a.hour >= 0 && a.hour < 24) {
      grid[a.weekday][a.hour] += 1;
    }
  }
  const weeks = Math.max(1, weeksObserved);
  return grid.map((row) => row.map((c) => c / weeks));
}

// Required agents per slot from the arrival profile and average handle time.
// Returns both the raw per-hour requirement and the SLA-window-smoothed one.
export function requiredAgentsGrid(
  profile: number[][],
  ahtMinutes: number,
  opts: StaffingOptions
): { raw: number[][]; smoothed: number[][] } {
  const effective = Math.max(0.05, opts.occupancy * (1 - opts.shrinkage));
  const k = Math.max(1, Math.round(opts.smoothingHours));

  // Workload as a flat 168-hour ring so the smoothing window flows across
  // midnight and weekday boundaries (Monday 00 pulls from Sunday 23).
  const workload: number[] = [];
  for (let wd = 0; wd < 7; wd++) {
    for (let h = 0; h < 24; h++) {
      workload.push((profile[wd][h] * ahtMinutes) / 60);
    }
  }

  const raw = emptyGrid();
  const smoothed = emptyGrid();
  for (let i = 0; i < 168; i++) {
    const wd = Math.floor(i / 24);
    const h = i % 24;
    raw[wd][h] = workload[i] > 0 ? Math.ceil(workload[i] / effective) : 0;

    // Trailing window: the hours whose arrivals this hour's staffing can
    // still absorb within the SLA.
    let sum = 0;
    for (let j = 0; j < k; j++) sum += workload[(i - j + 168) % 168];
    const avg = sum / k;
    smoothed[wd][h] = avg > 0 ? Math.ceil(avg / effective) : 0;
  }
  return { raw, smoothed };
}

export interface WorkSpan {
  startedAt: Date;
  lastSeenAt: Date;
}

// Actual hours worked per weekday × hour slot per observed week, from the
// persisted AgentWorkSessions. A session spanning an hour boundary is split
// proportionally. Stockholm offsets are whole hours, so UTC hour boundaries
// coincide with Stockholm ones — we clip at UTC boundaries and label the
// segment with its Stockholm slot.
export function actualHoursGrid(sessions: WorkSpan[], weeksObserved: number): number[][] {
  const grid = emptyGrid();
  const HOUR = 60 * 60 * 1000;
  for (const s of sessions) {
    let cursor = s.startedAt.getTime();
    const end = s.lastSeenAt.getTime();
    let guard = 0;
    while (cursor < end && guard++ < 24 * 90) {
      const hourEnd = (Math.floor(cursor / HOUR) + 1) * HOUR;
      const segEnd = Math.min(hourEnd, end);
      const slot = stockholmSlot(new Date(cursor));
      grid[slot.weekday][slot.hour] += (segEnd - cursor) / HOUR;
      cursor = segEnd;
    }
  }
  const weeks = Math.max(1, weeksObserved);
  return grid.map((row) => row.map((c) => c / weeks));
}

// Per-weekday roll-up of a required-agents grid: the day's peak concurrent
// agents and its total rostered agent-hours.
export function weekdaySummary(required: number[][]): Array<{ weekday: number; peakAgents: number; agentHours: number }> {
  return required.map((row, weekday) => ({
    weekday,
    peakAgents: Math.max(0, ...row),
    agentHours: row.reduce((a, b) => a + b, 0),
  }));
}
