// Shared resolution of the report time window. Extracted from the reports
// route so drill-down endpoints (e.g. the rewritten-replies list) describe
// exactly the same set of tickets as the aggregate panels — same range
// parameters, same Stockholm calendar-day semantics.
//
// The underlying Stockholm calendar helpers live in lib/time/stockholm.ts
// (shared with the ticket event log and the bemanning calculations); this
// module re-exports the ones the report endpoints use.

import {
  DAY_MS,
  dayKey,
  stockholmMidnight,
  shiftDayKey,
  stockholmWeekday,
} from '@/lib/time/stockholm';

export { DAY_MS, dayKey, stockholmMidnight, shiftDayKey, stockholmWeekday };

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
