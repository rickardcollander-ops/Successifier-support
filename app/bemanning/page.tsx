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
  required: { raw: number[][]; smoothed: number[][] } | null;
  actual: number[][];
  aht: { minutes: number; sampleCount: number; source: 'measured' | 'baseline' } | null;
  sessionsSince: string | null;
  params: { weeks: number; occupancy: number; shrinkage: number; smoothingHours: number; slaHours: number | null };
  weekdaySummary: Array<{ weekday: number; peakAgents: number; agentHours: number }> | null;
  totalArrivals: number;
}

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

  const hours = allHours
    ? Array.from({ length: 24 }, (_, h) => h)
    : Array.from({ length: BAND_END - BAND_START }, (_, i) => BAND_START + i);
  // Anything outside the displayed band worth mentioning?
  const outsideBand = !allHours && data.profile.some((row) =>
    row.some((c, h) => c > 0 && (h < BAND_START || h >= BAND_END))
  );

  const requiredGrid = data.required ? (showRaw ? data.required.raw : data.required.smoothed) : null;
  const maxProfile = Math.max(0.001, ...data.profile.flat());
  const maxRequired = requiredGrid ? Math.max(1, ...requiredGrid.flat()) : 1;
  const effectivePct = Math.round(data.params.occupancy * (1 - data.params.shrinkage) * 100);

  // Per-weekday comparison: recommended agent-hours vs actually worked hours.
  const actualPerDay = data.actual.map((row) => row.reduce((a, b) => a + b, 0));
  const requiredPerDay = requiredGrid ? requiredGrid.map((row) => row.reduce((a, b) => a + b, 0)) : null;
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
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
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
                  return (
                    <div
                      key={h}
                      title={`${t(WEEKDAYS[wd])} ${String(h).padStart(2, '0')}:00 – ${Math.round(v * 10) / 10} ${t('ärenden/vecka')}`}
                      className={`h-6 flex-1 rounded-sm ${v === 0 ? 'bg-slate-100 dark:bg-slate-700/40' : ''}`}
                      style={v > 0 ? { backgroundColor: `rgba(124, 92, 255, ${0.15 + 0.85 * (v / maxProfile)})` } : undefined}
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
              {t('Antal agenter som behöver vara i tjänst per timme för att hinna med inflödet.')}
              {data.params.smoothingHours > 1 && !showRaw &&
                ` ${t('Utjämnat över')} ${data.params.smoothingHours} ${t('timmar eftersom mejl kan vänta inom SLA-målet.')}`}
            </p>
            <div className="overflow-x-auto">
              <div className="min-w-[520px]">
                {requiredGrid.map((row, wd) => (
                  <div key={wd} className="flex items-center gap-1 mb-1">
                    <span className="w-10 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{t(WEEKDAYS[wd])}</span>
                    {hours.map((h) => {
                      const v = row[h];
                      return (
                        <div
                          key={h}
                          title={`${t(WEEKDAYS[wd])} ${String(h).padStart(2, '0')}:00 – ${v} ${t('agenter')}`}
                          className={`h-6 flex-1 rounded-sm flex items-center justify-center text-[10px] font-semibold ${
                            v === 0
                              ? 'bg-slate-100 dark:bg-slate-700/40 text-transparent'
                              : 'text-white'
                          }`}
                          style={v > 0 ? { backgroundColor: `rgba(16, 158, 106, ${0.35 + 0.65 * (v / maxRequired)})` } : undefined}
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
              {t('Formel:')} {t('ärenden/timme')} × {data.aht.minutes} {t('min/ärende')} ÷ {effectivePct}% {t('effektiv kapacitet')} ({Math.round(data.params.occupancy * 100)}% {t('beläggning')}, {Math.round(data.params.shrinkage * 100)}% {t('frånvaro')}){t(', avrundat uppåt.')}
              {' '}{data.aht.source === 'measured'
                ? `${t('Hanteringstid: median av')} ${data.aht.sampleCount} ${t('uppmätta ärenden.')}`
                : t('Hanteringstid: angiven baslinje (för få uppmätta ärenden ännu).')}
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
