'use client';

import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Users, Settings, Inbox, Scale } from 'lucide-react';
import { t } from '@/lib/i18n';

// Staffing recommendation page (bemanning). Shows the historical arrival
// pattern, the agents needed per weekday × hour derived from it, and how
// that compares with hours actually worked. All numbers come from
// /api/staffing; the formula is documented there and in lib/staffing.ts.

interface StaffingData {
  profile: number[][];
  required: {
    raw: number[][];
    smoothed: number[][];
    // Unrounded demand in fractional agents (one decimal) — what the grid
    // displays; raw/smoothed are the ceiled "book whole people" values.
    rawDemand?: number[][];
    smoothedDemand?: number[][];
  } | null;
  actual: number[][];
  aht: { minutes: number; sampleCount: number; source: 'measured' | 'baseline' } | null;
  sessionsSince: string | null;
  businessHours: Array<{ open: number; close: number } | null> | null;
  params: { weeks: number; occupancy: number; shrinkage: number; smoothingHours: number; slaHours: number | null };
  weekdaySummary: Array<{ weekday: number; peakAgents: number; agentHours: number }> | null;
  totalArrivals: number;
}

// Draft row for the öppettider editor. open < close is structurally
// guaranteed by the select options; "closed" maps to null in the saved
// config.
interface HoursDraftRow {
  closed: boolean;
  open: number;
  close: number;
}

const DEFAULT_HOURS_DRAFT: HoursDraftRow[] = Array.from({ length: 7 }, (_, wd) => ({
  closed: wd >= 5,
  open: 8,
  close: 17,
}));

const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`;

// Diagonal stripes marking closed hours in the heatmaps — inline style so
// it renders in both themes without extra CSS.
const CLOSED_STRIPES =
  'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(100,116,139,0.35) 3px, rgba(100,116,139,0.35) 6px)';

const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

// Most Swedish support volume lives in office hours — show a sane band by
// default and let the user expand to the full day.
const BAND_START = 6;
const BAND_END = 21; // exclusive

export default function BemanningPage() {
  const [data, setData] = useState<StaffingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState(8);
  const [allHours, setAllHours] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const [editingSettings, setEditingSettings] = useState(false);
  const [draft, setDraft] = useState({ staffingOccupancy: '', staffingShrinkage: '' });
  const [useHours, setUseHours] = useState(false);
  const [hoursDraft, setHoursDraft] = useState<HoursDraftRow[]>(DEFAULT_HOURS_DRAFT);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/staffing?weeks=${weeks}`);
      if (res.ok) setData(await res.json());
    } catch (error) {
      console.error('Error fetching staffing data:', error);
    } finally {
      setLoading(false);
    }
  }, [weeks]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/reports/settings');
        if (res.ok) {
          const s = await res.json();
          setDraft({
            staffingOccupancy: s.staffingOccupancy != null ? String(Math.round(s.staffingOccupancy * 100)) : '',
            staffingShrinkage: s.staffingShrinkage != null ? String(Math.round(s.staffingShrinkage * 100)) : '',
          });
          if (Array.isArray(s.businessHours)) {
            setUseHours(true);
            setHoursDraft(
              s.businessHours.map((d: { open: number; close: number } | null, wd: number) =>
                d ? { closed: false, open: d.open, close: d.close } : { ...DEFAULT_HOURS_DRAFT[wd], closed: true }
              )
            );
          }
        }
      } catch (error) {
        console.error('Error fetching staffing settings:', error);
      }
    })();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/reports/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffingOccupancy: draft.staffingOccupancy,
          staffingShrinkage: draft.staffingShrinkage,
          businessHours: useHours
            ? hoursDraft.map((r) => (r.closed ? null : { open: r.open, close: r.close }))
            : null,
        }),
      });
      if (res.ok) {
        setEditingSettings(false);
        fetchData();
      }
    } catch (error) {
      console.error('Error saving staffing settings:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">{t('Beräknar bemanning…')}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">{t('Ingen data tillgänglig')}</div>
      </div>
    );
  }

  // Display band: derived from the configured öppettider (one hour of
  // margin on each side so the rollforward context is visible), falling
  // back to the generic office band when hours aren't configured.
  const openDays = (data.businessHours ?? []).filter((d): d is { open: number; close: number } => d != null);
  const bandStart = openDays.length > 0 ? Math.max(0, Math.min(...openDays.map((d) => d.open)) - 1) : BAND_START;
  const bandEnd = openDays.length > 0 ? Math.min(24, Math.max(...openDays.map((d) => d.close)) + 1) : BAND_END;
  const hours = allHours
    ? Array.from({ length: 24 }, (_, h) => h)
    : Array.from({ length: bandEnd - bandStart }, (_, i) => bandStart + i);
  // Anything outside the displayed band worth mentioning?
  const outsideBand = !allHours && data.profile.some((row) =>
    row.some((c, h) => c > 0 && (h < bandStart || h >= bandEnd))
  );

  // Is this weekday×hour outside öppettider? Only meaningful when hours
  // are configured — without them nothing is "closed".
  const closedSlot = (wd: number, h: number): boolean => {
    if (!data.businessHours) return false;
    const day = data.businessHours[wd];
    return day == null || h < day.open || h >= day.close;
  };

  const requiredGrid = data.required ? (showRaw ? data.required.raw : data.required.smoothed) : null;
  // The grid shows the decimal DEMAND (0.3 agents tells you something; a
  // wall of ceiled 1:or does not). Fall back to the ceiled grid for older
  // payloads without demand.
  const demandGrid = data.required
    ? (showRaw ? data.required.rawDemand : data.required.smoothedDemand) ?? requiredGrid
    : null;
  const maxProfile = Math.max(0.001, ...data.profile.flat());
  const maxDemand = demandGrid ? Math.max(0.5, ...demandGrid.flat()) : 1;
  const effectivePct = Math.round(data.params.occupancy * (1 - data.params.shrinkage) * 100);

  // Per-weekday comparison: recommended agent-hours (unrounded workload —
  // summing ceiled hours would overstate a small team's day) vs actually
  // worked hours.
  const actualPerDay = data.actual.map((row) => row.reduce((a, b) => a + b, 0));
  const requiredPerDay = demandGrid ? demandGrid.map((row) => row.reduce((a, b) => a + b, 0)) : null;
  const maxDayHours = Math.max(1, ...actualPerDay, ...(requiredPerDay ?? []));

  const fmtSince = data.sessionsSince
    ? new Date(data.sessionsSince).toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t('Bemanning')}</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            {t('Agentbehov och rekommenderat schema utifrån historiskt ärendeflöde')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <select
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
          >
            <option value={4}>{t('Senaste 4 veckorna')}</option>
            <option value={8}>{t('Senaste 8 veckorna')}</option>
            <option value={12}>{t('Senaste 12 veckorna')}</option>
          </select>
          <button
            onClick={() => setEditingSettings((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600"
          >
            <Settings className="w-4 h-4" /> {t('Antaganden')}
          </button>
        </div>
      </div>

      {editingSettings && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                {t('Beläggning (%) – andel av arbetad timme som går till ärenden')}
              </label>
              <input
                type="number" min="1" max="99" inputMode="numeric"
                value={draft.staffingOccupancy}
                onChange={(e) => setDraft((d) => ({ ...d, staffingOccupancy: e.target.value }))}
                placeholder={t('standard 80')}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                {t('Frånvaro/övrigt (%) – raster, möten, sjukdom')}
              </label>
              <input
                type="number" min="0" max="99" inputMode="numeric"
                value={draft.staffingShrinkage}
                onChange={(e) => setDraft((d) => ({ ...d, staffingShrinkage: e.target.value }))}
                placeholder={t('standard 10')}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm"
              />
            </div>
          </div>

          {/* Öppettider: per weekday open/close, or closed. Off = 24/7. */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-md p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
              <input
                type="checkbox"
                checked={useHours}
                onChange={(e) => setUseHours(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600"
              />
              {t('Använd öppettider')}
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-3">
              {t('Bemanningen planeras inom öppettiderna (volym utanför räknas in i första öppna timmen) och SLA/första svarstid räknas i öppettid. Avstängt = dygnet runt.')}
            </p>
            {useHours && (
              <div className="space-y-1.5">
                {hoursDraft.map((row, wd) => (
                  <div key={wd} className="flex items-center gap-3 text-sm">
                    <span className="w-10 text-slate-700 dark:text-slate-300">{t(WEEKDAYS[wd])}</span>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <input
                        type="checkbox"
                        checked={row.closed}
                        onChange={(e) =>
                          setHoursDraft((d) => d.map((r, i) => (i === wd ? { ...r, closed: e.target.checked } : r)))
                        }
                        className="rounded border-slate-300 dark:border-slate-600"
                      />
                      {t('Stängt')}
                    </label>
                    {!row.closed && (
                      <>
                        <select
                          value={row.open}
                          onChange={(e) => {
                            const open = Number(e.target.value);
                            setHoursDraft((d) =>
                              d.map((r, i) =>
                                i === wd ? { ...r, open, close: Math.max(r.close, open + 1) } : r
                              )
                            );
                          }}
                          aria-label={`${t(WEEKDAYS[wd])} ${t('öppnar')}`}
                          className="px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                        >
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={h}>{fmtHour(h)}</option>
                          ))}
                        </select>
                        <span className="text-slate-400">–</span>
                        <select
                          value={row.close}
                          onChange={(e) =>
                            setHoursDraft((d) =>
                              d.map((r, i) => (i === wd ? { ...r, close: Number(e.target.value) } : r))
                            )
                          }
                          aria-label={`${t(WEEKDAYS[wd])} ${t('stänger')}`}
                          className="px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                        >
                          {Array.from({ length: 24 - row.open }, (_, i) => row.open + 1 + i).map((h) => (
                            <option key={h} value={h}>{fmtHour(h)}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                ))}
                {hoursDraft.every((r) => r.closed) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    {t('Alla dagar stängda = öppettider inaktiveras vid sparande.')}
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            onClick={saveSettings}
            disabled={saving}
            className="px-4 py-2 rounded-md bg-[#7C5CFF] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50"
          >
            {saving ? t('Sparar…') : t('Spara')}
          </button>
        </div>
      )}

      {/* Panel 1: arrival profile */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Inbox className="w-5 h-5 text-[#7C5CFF]" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Inkommande volym per timme')}</h3>
          </div>
          <button
            onClick={() => setAllHours((v) => !v)}
            className="text-xs text-[#7C5CFF] hover:underline"
          >
            {allHours ? t('Visa kontorstid') : t('Visa alla timmar')}
          </button>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          {t('Genomsnittligt antal ärenden per timme och veckodag (svensk tid), baserat på')} {data.totalArrivals} {t('ärenden de senaste')} {data.params.weeks} {t('veckorna.')}
        </p>
        <div className="overflow-x-auto">
          <div className="min-w-[520px]">
            {data.profile.map((row, wd) => (
              <div key={wd} className="flex items-center gap-1 mb-1">
                <span className="w-10 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{t(WEEKDAYS[wd])}</span>
                {hours.map((h) => {
                  const v = row[h];
                  const closed = closedSlot(wd, h);
                  // Closed slots keep their volume color (that volume is
                  // exactly what rolls forward to opening) but get stripes
                  // so it reads as "arrives while closed".
                  return (
                    <div
                      key={h}
                      title={`${t(WEEKDAYS[wd])} ${String(h).padStart(2, '0')}:00 – ${Math.round(v * 10) / 10} ${t('ärenden/vecka')}${closed ? ` (${t('stängt')})` : ''}`}
                      className={`h-6 flex-1 rounded-sm ${v === 0 ? 'bg-slate-100 dark:bg-slate-700/40' : ''}`}
                      style={{
                        ...(v > 0 ? { backgroundColor: `rgba(124, 92, 255, ${0.15 + 0.85 * (v / maxProfile)})` } : {}),
                        ...(closed ? { backgroundImage: CLOSED_STRIPES } : {}),
                      }}
                    />
                  );
                })}
              </div>
            ))}
            <div className="flex items-center gap-1 mt-1">
              <span className="w-10 shrink-0" />
              {hours.map((h) => (
                <span key={h} className="flex-1 text-center text-[9px] text-slate-400">
                  {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
        {outsideBand && (
          <p className="text-[11px] text-slate-400 mt-2">
            {t('Det finns även volym utanför visade timmar — klicka "Visa alla timmar".')}
          </p>
        )}
      </div>

      {/* Panel 2: recommended staffing */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Rekommenderad bemanning')}</h3>
          </div>
          {data.required && (
            <button onClick={() => setShowRaw((v) => !v)} className="text-xs text-[#7C5CFF] hover:underline">
              {showRaw ? t('Visa utjämnad (rekommenderas)') : t('Visa utan utjämning')}
            </button>
          )}
        </div>
        {!data.aht || !requiredGrid ? (
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            {t('För lite data för att räkna ut agentbehov: det behövs minst 10 ärenden med uppmätt aktiv arbetstid (eller en angiven baslinje i rapportinställningarna). Hanteringstiden mäts automatiskt medan agenter arbetar i ärenden.')}
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              {t('Bemanningsbehov per timme, i agenter — 0,3 betyder en tredjedels agents arbete. Håll muspekaren över en ruta för att se hur många hela personer som behöver bokas.')}
              {data.params.smoothingHours > 1 && !showRaw &&
                ` ${t('Utjämnat över')} ${data.params.smoothingHours} ${t('timmar eftersom mejl kan vänta inom SLA-målet.')}`}
            </p>
            <div className="overflow-x-auto">
              <div className="min-w-[520px]">
                {requiredGrid.map((row, wd) => (
                  <div key={wd} className="flex items-center gap-1 mb-1">
                    <span className="w-10 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{t(WEEKDAYS[wd])}</span>
                    {hours.map((h) => {
                      const booked = row[h];
                      // Displayed value: fractional agents needed (0.3 says
                      // more than a ceiled 1). Whole-person booking lives in
                      // the tooltip.
                      const v = demandGrid ? demandGrid[wd][h] : booked;
                      const closed = closedSlot(wd, h);
                      return (
                        <div
                          key={h}
                          title={
                            closed
                              ? `${t(WEEKDAYS[wd])} ${String(h).padStart(2, '0')}:00 – ${t('stängt')}`
                              : `${t(WEEKDAYS[wd])} ${String(h).padStart(2, '0')}:00 – ${t('behov')} ${v} ${t('agenter')}${booked > 0 ? ` (${t('boka')} ${booked})` : ''}`
                          }
                          className={`h-6 flex-1 rounded-sm flex items-center justify-center text-[10px] font-semibold ${
                            v === 0
                              ? 'bg-slate-100 dark:bg-slate-700/40 text-transparent'
                              : 'text-white'
                          }`}
                          style={{
                            ...(v > 0 ? { backgroundColor: `rgba(16, 158, 106, ${0.35 + 0.65 * Math.min(1, v / maxDemand)})` } : {}),
                            ...(closed ? { backgroundImage: CLOSED_STRIPES } : {}),
                          }}
                        >
                          {v > 0 ? v : ''}
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-1 mt-1">
                  <span className="w-10 shrink-0" />
                  {hours.map((h) => (
                    <span key={h} className="flex-1 text-center text-[9px] text-slate-400">
                      {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {data.weekdaySummary && (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2 font-medium">{t('Veckodag')}</th>
                      <th className="py-2 font-medium">{t('Flest samtidiga agenter')}</th>
                      <th className="py-2 font-medium">{t('Agenttimmar totalt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.weekdaySummary.map((d) => (
                      <tr key={d.weekday} className="border-b border-slate-100 dark:border-slate-700/50 last:border-0">
                        <td className="py-2 text-slate-900 dark:text-slate-100">{t(WEEKDAYS[d.weekday])}</td>
                        <td className="py-2 text-slate-700 dark:text-slate-300">{d.peakAgents}</td>
                        <td className="py-2 text-slate-700 dark:text-slate-300">{d.agentHours} h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-[11px] text-slate-400 mt-4">
              {t('Formel:')} {t('ärenden/timme')} × {data.aht.minutes} {t('min/ärende')} ÷ {effectivePct}% {t('effektiv kapacitet')} ({Math.round(data.params.occupancy * 100)}% {t('beläggning')}, {Math.round(data.params.shrinkage * 100)}% {t('frånvaro')}){t('. Decimaler visar behovet; "Flest samtidiga agenter" avrundas uppåt till hela personer.')}
              {' '}{data.aht.source === 'measured'
                ? `${t('Hanteringstid: median av')} ${data.aht.sampleCount} ${t('uppmätta ärenden.')}`
                : t('Hanteringstid: angiven baslinje (för få uppmätta ärenden ännu).')}
              {data.businessHours && ` ${t('Volym som kommer in utanför öppettid räknas in i första öppna timmen.')}`}
            </p>
          </>
        )}
      </div>

      {/* Panel 3: recommended vs actual hours */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Scale className="w-5 h-5 text-[#7C5CFF]" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Rekommenderat vs faktiskt arbetat')}</h3>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          {t('Agenttimmar per veckodag: vad flödet kräver jämfört med tid faktiskt arbetad i ärenden (genomsnitt per vecka).')}
          {fmtSince && ` ${t('Faktisk tid mäts sedan')} ${fmtSince}${t(' och fylls på framåt.')}`}
        </p>
        {!requiredPerDay && actualPerDay.every((v) => v === 0) ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('Ingen data ännu.')}</p>
        ) : (
          <div className="space-y-3">
            {WEEKDAYS.map((label, wd) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1 text-xs text-slate-600 dark:text-slate-400">
                  <span>{t(label)}</span>
                  <span>
                    {requiredPerDay && <span className="font-semibold text-emerald-600 dark:text-emerald-400">{Math.round(requiredPerDay[wd] * 10) / 10} h {t('rek.')}</span>}
                    <span className="mx-1 text-slate-300">·</span>
                    <span className="font-semibold text-[#7C5CFF]">{Math.round(actualPerDay[wd] * 10) / 10} h {t('arbetat')}</span>
                  </span>
                </div>
                {requiredPerDay && (
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mb-1">
                    <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${(requiredPerDay[wd] / maxDayHours) * 100}%` }} />
                  </div>
                )}
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div className="bg-[#7C5CFF] h-2 rounded-full" style={{ width: `${(actualPerDay[wd] / maxDayHours) * 100}%` }} />
                </div>
              </div>
            ))}
            <div className="flex items-center gap-4 pt-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500" /> {t('Rekommenderat')}</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#7C5CFF]" /> {t('Faktiskt arbetat')}</span>
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
        <CalendarClock className="w-3.5 h-3.5" />
        {t('Prognosen är ett historiskt genomsnitt per veckodag och timme — den ser inte helgdagar, kampanjer eller säsongstoppar.')}
      </p>
    </div>
  );
}
