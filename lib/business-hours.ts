import {
  HOUR_MS,
  dayKey,
  shiftDayKey,
  stockholmMidnight,
  stockholmWeekday,
  parseStockholmTimestamp,
} from '@/lib/time/stockholm';

// Öppettider (business hours) for the support team, per Stockholm weekday.
// Used by the staffing (bemanning) calculations — agents are only planned
// during open hours, with closed-hour volume rolling forward to opening —
// and by the SLA/first-response metrics, which count elapsed OPEN hours
// when hours are configured (a Friday-evening mail answered Monday 09:00
// is 1 open hour, not ~60 calendar hours).
//
// Shape: exactly 7 entries, Monday = 0 … Sunday = 6. Whole hours,
// 0 <= open < close <= 24, close exclusive; null = closed all day.
// Limitation: overnight spans (open 22, close 06) cannot be expressed —
// acceptable for an office-hours support team, and the UI can't build one.
//
// Everything here is pure (no prisma, no clock) so it can be unit-tested.

export interface DayHours {
  open: number;
  close: number;
}

export type BusinessHours = Array<DayHours | null>;

// Validate an unknown value (the JSON column, a PUT body) into canonical
// BusinessHours, or null when it isn't one. All-7-days-closed also returns
// null: an always-closed support desk is nonsense config, and collapsing it
// to "not configured" removes a whole class of divide-by-nothing bugs at
// the source. Same philosophy as optionalPositive in the settings route —
// nonsense clears the value rather than erroring.
export function parseBusinessHours(value: unknown): BusinessHours | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const out: BusinessHours = [];
  for (const entry of value) {
    if (entry === null) {
      out.push(null);
      continue;
    }
    if (typeof entry !== 'object' || entry === null) return null;
    const open = (entry as Record<string, unknown>).open;
    const close = (entry as Record<string, unknown>).close;
    if (
      typeof open !== 'number' || typeof close !== 'number' ||
      !Number.isInteger(open) || !Number.isInteger(close) ||
      open < 0 || close > 24 || open >= close
    ) {
      return null;
    }
    // Rebuild so extra keys never round-trip into the column.
    out.push({ open, close });
  }
  return out.every((d) => d === null) ? null : out;
}

export function isOpen(bh: BusinessHours, weekday: number, hour: number): boolean {
  const day = bh[weekday];
  return day != null && hour >= day.open && hour < day.close;
}

// 7×24 boolean grid (Monday = 0) for the staffing math.
export function openMask(bh: BusinessHours): boolean[][] {
  return Array.from({ length: 7 }, (_, wd) =>
    Array.from({ length: 24 }, (_, h) => isOpen(bh, wd, h))
  );
}

// Resolving a day's open/close instants costs Intl.DateTimeFormat calls,
// and businessHoursBetween runs inside loops over thousands of tickets that
// all share the same window of days — memoise per (day, open-close). The
// key is independent of which BusinessHours object asked, so a module-level
// map is safe.
const dayWindowCache = new Map<string, { startMs: number; endMs: number }>();

function dayOpenWindow(key: string, day: DayHours): { startMs: number; endMs: number } {
  const cacheKey = `${key}:${day.open}-${day.close}`;
  const cached = dayWindowCache.get(cacheKey);
  if (cached) return cached;
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = parseStockholmTimestamp(`${key} ${pad(day.open)}:00:00`);
  const end =
    day.close === 24
      ? stockholmMidnight(shiftDayKey(key, 1))
      : parseStockholmTimestamp(`${key} ${pad(day.close)}:00:00`);
  const window = { startMs: start?.getTime() ?? 0, endMs: end?.getTime() ?? 0 };
  dayWindowCache.set(cacheKey, window);
  return window;
}

// Elapsed open hours (fractional, in real hours) between two instants.
// Walks calendar days and sums each day's overlap with its open window —
// resolving real UTC instants per day makes DST correct by construction:
// Friday 16:00 → Monday 09:00 across a closed weekend with Mon–Fri 8–17 is
// exactly 2.0 regardless of a transition in between. A day whose open
// window CONTAINS the transition contributes elapsed real hours (±1 vs
// wall-clock hours) — same stance as parseStockholmTimestamp's documented
// fall-back ambiguity.
export function businessHoursBetween(bh: BusinessHours, from: Date, to: Date): number {
  const toMs = to.getTime();
  // Clamp pathologically old starts (openOverdue ages can predate the
  // system) so the day walk stays bounded.
  const fromMs = Math.max(from.getTime(), toMs - 5 * 365 * 24 * HOUR_MS);
  if (toMs <= fromMs) return 0;

  let totalMs = 0;
  const lastKey = dayKey(new Date(toMs));
  let key = dayKey(new Date(fromMs));
  for (let guard = 0; guard < 4000; guard++) {
    const weekday = stockholmWeekday(stockholmMidnight(key));
    const day = bh[weekday];
    if (day) {
      const { startMs, endMs } = dayOpenWindow(key, day);
      totalMs += Math.max(0, Math.min(toMs, endMs) - Math.max(fromMs, startMs));
    }
    if (key === lastKey) break;
    key = shiftDayKey(key, 1);
  }
  return totalMs / HOUR_MS;
}
