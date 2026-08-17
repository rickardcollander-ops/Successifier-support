// Europe/Stockholm calendar helpers shared by the reports API, the ticket
// event log and the staffing (bemanning) calculations. The server runs in
// UTC, so naive Date bucketing anchors days at UTC midnight — tickets
// arriving 00:00–02:00 Swedish time would land on the previous day. All
// "per day" / "per hour slot" logic must go through these helpers instead.

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// sv-SE formatting yields "YYYY-MM-DD", which is used directly as bucket key.
export const dayKey = (d: Date) =>
  d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

// The offset (ms) between Stockholm wall-clock time and UTC at a given instant.
// Used to turn a Stockholm calendar date into the real UTC instant of its
// midnight, correctly across DST.
export function stockholmOffsetMs(utcMillis: number): number {
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

// Weekday (Monday = 0) and wall-clock hour in Stockholm for an instant, in a
// single formatToParts call — this runs once per ticket in the heatmap and
// staffing loops, so avoid formatting twice.
export function stockholmSlot(d: Date): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm', hour12: false,
    weekday: 'short', hour: '2-digit',
  }).formatToParts(d);
  let weekday = 0;
  let hour = 0;
  for (const p of parts) {
    if (p.type === 'weekday') {
      weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.value);
    } else if (p.type === 'hour') {
      const h = Number(p.value);
      hour = h === 24 ? 0 : h; // some engines report midnight as 24
    }
  }
  return { weekday, hour };
}

// Parse a "YYYY-MM-DD HH:MM:SS" string written in Stockholm wall time (the
// format the thread separators use — toLocaleString('sv-SE', Europe/Stockholm))
// back into a real UTC instant. During the autumn DST fall-back the wall time
// 02:xx is ambiguous; whichever offset the first guess resolves to is used —
// acceptable noise for report backfill.
export function parseStockholmTimestamp(s: string): Date | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? 0));
  const parsed = new Date(guess - stockholmOffsetMs(guess));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
