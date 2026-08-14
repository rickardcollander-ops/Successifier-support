// Shared resolution of the report time window. Extracted from the reports
// route so drill-down endpoints (e.g. the rewritten-replies list) describe
// exactly the same set of tickets as the aggregate panels — same range
// parameters, same Stockholm calendar-day semantics.

const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// All "per day" logic uses calendar days in Europe/Stockholm — the team's
// timezone. sv-SE formatting yields "YYYY-MM-DD", which is used directly as
// bucket key.
export const dayKey = (d: Date) =>
  d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

// The offset (ms) between Stockholm wall-clock time and UTC at a given instant.
function stockholmOffsetMs(utcMillis: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMillis));
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') m[p.type] = Number(p.value);
  // 24:00 can appear for midnight in some engines; normalise to 0.
  const hour = m.hour === 24 ? 0 : m.hour;
  return Date.UTC(m.year, m.month - 1, m.day, hour, m.minute, m.second) - utcMillis;
}

// Real UTC instant of 00:00 Stockholm time on the given YYYY-MM-DD.
export function stockholmMidnight(key: string): Date {
  const [y, mo, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d);
  return new Date(guess - stockholmOffsetMs(guess));
}

// Shift a YYYY-MM-DD calendar key by whole days. Pure UTC calendar math (no
// DST), so it always lands on the intended date.
export function shiftDayKey(key: string, deltaDays: number): string {
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d) + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

// Monday = 0 … Sunday = 6, in Stockholm — for anchoring "this/last week".
export function stockholmWeekday(d: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Stockholm', weekday: 'short' }).format(d);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd);
}

export interface ReportWindow {
  windowStart: Date;
  windowEnd: Date;
  isHourly: boolean;
}

// Resolve [windowStart, windowEnd) from the range parameters. Named calendar
// ranges (this/last week & month) are anchored to Stockholm calendar
// boundaries; "custom" reads explicit from/to dates; the rolling "senaste N"
// ranges end at `now`.
export function resolveReportWindow(
  range: string,
  fromParam: string | null,
  toParam: string | null,
  now: Date = new Date()
): ReportWindow {
  const isHourly = range === '1d';
  const isDateKey = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

  const nowKey = dayKey(now);
  const [nowY, nowM] = nowKey.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');

  let windowStart: Date;
  let windowEnd: Date;
  if (isHourly) {
    windowStart = new Date(now.getTime() - DAY_MS);
    windowEnd = now;
  } else if (range === 'thisWeek') {
    windowStart = stockholmMidnight(shiftDayKey(nowKey, -stockholmWeekday(now)));
    windowEnd = now;
  } else if (range === 'lastWeek') {
    const thisMonday = shiftDayKey(nowKey, -stockholmWeekday(now));
    windowStart = stockholmMidnight(shiftDayKey(thisMonday, -7));
    windowEnd = stockholmMidnight(thisMonday);
  } else if (range === 'thisMonth') {
    windowStart = stockholmMidnight(`${nowY}-${pad(nowM)}-01`);
    windowEnd = now;
  } else if (range === 'lastMonth') {
    const prevY = nowM === 1 ? nowY - 1 : nowY;
    const prevM = nowM === 1 ? 12 : nowM - 1;
    windowStart = stockholmMidnight(`${prevY}-${pad(prevM)}-01`);
    windowEnd = stockholmMidnight(`${nowY}-${pad(nowM)}-01`);
  } else if (range === 'custom' && isDateKey(fromParam) && isDateKey(toParam) && fromParam <= toParam) {
    // Inclusive day range: end is midnight AFTER the `to` day. Cap the span
    // (to ~1 year) so a hand-typed URL can't request thousands of buckets,
    // and never let the end run past `now`.
    const minFrom = shiftDayKey(toParam, -365);
    windowStart = stockholmMidnight(fromParam < minFrom ? minFrom : fromParam);
    windowEnd = stockholmMidnight(shiftDayKey(toParam, 1));
    if (windowEnd.getTime() > now.getTime()) windowEnd = now;
  } else {
    // Rolling "senaste N dagar": today plus the previous N-1 calendar days.
    const daysAgo = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    windowStart = stockholmMidnight(shiftDayKey(nowKey, -(daysAgo - 1)));
    windowEnd = now;
  }

  return { windowStart, windowEnd, isHourly };
}
