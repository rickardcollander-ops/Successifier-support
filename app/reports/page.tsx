'use client';

import { useState, useEffect } from 'react';
import { BarChart3, Clock, CheckCircle, AlertCircle, Users, Send, Timer, TrendingDown, Sparkles, PencilLine, MousePointerClick, Wallet, Settings, CalendarDays, Layers, MessageSquare, Target } from 'lucide-react';
import { t } from '@/lib/i18n';
import { AGENTS, statusLabelSv, priorityLabelSv } from '@/lib/constants';

// Below this many tickets in a group we don't make comparative claims — a
// "23% faster" line off a handful of tickets is noise, not a result.
const MIN_GROUP = 15;
// One agent handling more than this share of all replies is a key-person risk
// worth surfacing to whoever reads the report.
const KEY_PERSON_SHARE = 0.7;

interface AgentStats {
  name: string;
  assigned: number;
  sent: number;
}

interface GroupStats {
  count: number;
  responseMedian: number;
  handlingMedian: number;
  handlingP90: number;
  handledCount: number;
}

interface Savings {
  agentHourlyCost: number | null;
  baselineHandlingMinutes: number | null;
  baselineResponseHours: number | null;
  baselineSource: 'configured' | 'no_ai_group' | null;
  ticketsHandled: number;
  activeWorkMedianMinutes: number;
  activeWorkSampleCount: number;
  savedMinutesPerTicket: number | null;
  savedHours: number | null;
  moneySaved: number | null;
}

interface ReportData {
  totalTickets: number;
  ticketsByStatus: Record<string, number>;
  medianResponseTime: number;
  avgResponseTime: number;
  resolvedToday: number;
  pendingTickets: number;
  totalSent: number;
  recentActivity: Array<{ date: string; count: number }>;
  activityInterval?: 'hour' | 'day';
  perUserStats?: AgentStats[];
  trend?: Array<{ label: string; responseMedian: number; handlingMedian: number; count: number }>;
  aiComparison?: {
    fromAi: GroupStats;
    builtOn: GroupStats;
    mostlyNew: GroupStats;
    none: GroupStats;
  };
  savings?: Savings;
  editStats?: {
    count: number;
    medianChangedPct: number;
    medianKeptPct: number;
    unchanged: number;
    light: number;
    heavy: number;
  };
  activeWork?: {
    count: number;
    medianMinutes: number;
    avgMinutes: number;
  };
  filtersApplied?: { agent: string | null; status: string | null; priority: string | null };
  heatmap?: number[][];
  firstResponse?: {
    count: number;
    basis?: 'business' | 'calendar';
    medianHours: number;
    p90Hours: number;
    medianHoursCalendar?: number;
    p90HoursCalendar?: number;
  };
  repliesPerTicket?: {
    ticketCount: number;
    avg: number;
    distribution: { one: number; two: number; threePlus: number };
  };
  sla?: null | {
    targetHours: number;
    basis?: 'business' | 'calendar';
    answered: number;
    met: number;
    attainmentPct: number | null;
    openOverdue: {
      count: number;
      tickets: Array<{ id: string; subject: string; ageHours: number; ageHoursCalendar?: number }>;
    };
  };
  backlog?: Array<{ date: string; open: number; approximate: boolean }>;
}

interface RoiSettings {
  agentHourlyCost: number | null;
  baselineHandlingMinutes: number | null;
  baselineResponseHours: number | null;
  slaFirstResponseHours: number | null;
}

// One rewritten reply from /api/reports/rewritten — draft vs what was sent.
interface RewrittenItem {
  ticketId: string;
  subject: string;
  customerEmail: string;
  sentAt: string | null;
  sentBy: string | null;
  keptPct: number;
  question: string;
  aiDraft: string;
  sentReply: string;
}

type TimeRange = '1d' | '7d' | '30d' | '90d' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'custom';

// Local YYYY-MM-DD for <input type="date"> defaults — must be the browser's
// local calendar date, not the UTC slice of toISOString().
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  // Custom date range (only used when timeRange === 'custom'). Default to the
  // last 7 days so the picker opens on something sensible.
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [customTo, setCustomTo] = useState(todayInput);

  // ROI inputs (team-specific, not invented): time per ticket before the tool
  // and the fully-loaded hourly cost of an agent. Without them we don't show a
  // money figure at all — we ask for them instead.
  const [roi, setRoi] = useState<RoiSettings | null>(null);
  const [editingRoi, setEditingRoi] = useState(false);
  const [roiDraft, setRoiDraft] = useState({ baselineHandlingMinutes: '', agentHourlyCost: '', slaFirstResponseHours: '' });
  const [savingRoi, setSavingRoi] = useState(false);

  // Filters: '' = no filter. Applied server-side; the API echoes what it
  // actually applied in filtersApplied.
  const [filterAgent, setFilterAgent] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const filtersActive = Boolean(filterAgent || filterStatus || filterPriority);

  // Rewritten-replies drill-down (lazy: only fetched when the list is opened).
  const [showRewritten, setShowRewritten] = useState(false);
  const [rewritten, setRewritten] = useState<RewrittenItem[] | null>(null);
  const [loadingRewritten, setLoadingRewritten] = useState(false);
  const [expandedRewritten, setExpandedRewritten] = useState<string | null>(null);

  // A custom range with from after to is invalid — don't fetch (and don't
  // blank the current data) until it's sane.
  const customInvalid = timeRange === 'custom' && customFrom > customTo;

  useEffect(() => {
    if (customInvalid) return;
    fetchReportData();
    // The drill-down list belongs to the old window — drop it so an open list
    // refetches for the new range instead of showing stale rows.
    setRewritten(null);
  }, [timeRange, customFrom, customTo, filterAgent, filterStatus, filterPriority]);

  useEffect(() => {
    if (!showRewritten || rewritten !== null || customInvalid) return;
    const fetchRewritten = async () => {
      setLoadingRewritten(true);
      try {
        const params = new URLSearchParams({ range: timeRange });
        if (timeRange === 'custom') {
          params.set('from', customFrom);
          params.set('to', customTo);
        }
        const res = await fetch(`/api/reports/rewritten?${params.toString()}`);
        if (res.ok) {
          const payload = await res.json();
          setRewritten(payload.items || []);
        }
      } catch (error) {
        console.error('Error fetching rewritten replies:', error);
      } finally {
        setLoadingRewritten(false);
      }
    };
    fetchRewritten();
  }, [showRewritten, rewritten, timeRange, customFrom, customTo, customInvalid]);

  useEffect(() => {
    fetchRoiSettings();
  }, []);

  const fetchReportData = async () => {
    try {
      const params = new URLSearchParams({ range: timeRange });
      if (timeRange === 'custom') {
        params.set('from', customFrom);
        params.set('to', customTo);
      }
      if (filterAgent) params.set('agent', filterAgent);
      if (filterStatus) params.set('status', filterStatus);
      if (filterPriority) params.set('priority', filterPriority);
      const response = await fetch(`/api/reports?${params.toString()}`);
      if (response.ok) setData(await response.json());
    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRoiSettings = async () => {
    try {
      const res = await fetch('/api/reports/settings');
      if (res.ok) {
        const s: RoiSettings = await res.json();
        setRoi(s);
        setRoiDraft({
          baselineHandlingMinutes: s.baselineHandlingMinutes != null ? String(s.baselineHandlingMinutes) : '',
          agentHourlyCost: s.agentHourlyCost != null ? String(s.agentHourlyCost) : '',
          slaFirstResponseHours: s.slaFirstResponseHours != null ? String(s.slaFirstResponseHours) : '',
        });
      }
    } catch (error) {
      console.error('Error fetching ROI settings:', error);
    }
  };

  const saveRoiSettings = async () => {
    setSavingRoi(true);
    try {
      const res = await fetch('/api/reports/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baselineHandlingMinutes: roiDraft.baselineHandlingMinutes,
          agentHourlyCost: roiDraft.agentHourlyCost,
          slaFirstResponseHours: roiDraft.slaFirstResponseHours,
        }),
      });
      if (res.ok) {
        setRoi(await res.json());
        setEditingRoi(false);
        fetchReportData(); // recompute money saved with the new baseline/cost
      }
    } catch (error) {
      console.error('Error saving ROI settings:', error);
    } finally {
      setSavingRoi(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">{t('Laddar rapporter…')}</div>
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

  // Minute formatter shared by the active-work and comparison panels.
  const fmtMinutes = (minutes: number): string => {
    if (!minutes || minutes <= 0) return '–';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    return `${Math.round((minutes / 60) * 10) / 10} h`;
  };

  const trend = data.trend || [];
  const aiComparison = data.aiComparison;
  const editStats = data.editStats;
  const activeWork = data.activeWork;
  const savings = data.savings;

  const perUserStats = data.perUserStats || [];
  const maxAgentTotal = Math.max(1, ...perUserStats.map((s) => s.assigned + s.sent));
  const topShare = data.totalSent > 0
    ? Math.max(0, ...perUserStats.map((s) => s.sent)) / data.totalSent
    : 0;
  const topAgent = perUserStats.find((s) => s.sent === Math.max(0, ...perUserStats.map((p) => p.sent)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t('Rapporter')}</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">{t('Statistik och analys')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
          >
            <option value="1d">{t('Senaste dygnet')}</option>
            <option value="7d">{t('Senaste 7 dagarna')}</option>
            <option value="30d">{t('Senaste 30 dagarna')}</option>
            <option value="90d">{t('Senaste 90 dagarna')}</option>
            <option value="thisWeek">{t('Denna vecka')}</option>
            <option value="lastWeek">{t('Förra veckan')}</option>
            <option value="thisMonth">{t('Denna månad')}</option>
            <option value="lastMonth">{t('Förra månaden')}</option>
            <option value="custom">{t('Anpassad period')}</option>
          </select>
          {timeRange === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label={t('Från datum')}
                className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm"
              />
              <span className="text-slate-400 text-sm">–</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={todayInput()}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label={t('Till datum')}
                className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm"
              />
            </div>
          )}
        </div>
      </div>
      {customInvalid && (
        <p className="text-sm text-red-500">{t('Från-datumet måste vara före till-datumet.')}</p>
      )}

      {/* Filter row: narrow every panel that describes the created/sent
          populations down to one agent / status / priority. Team-level
          panels (ROI, SLA, backlogg, lösta idag) deliberately ignore the
          filters and say so. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500 dark:text-slate-400">{t('Filtrera:')}</span>
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          aria-label={t('Medarbetare')}
          className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
        >
          <option value="">{t('Alla medarbetare')}</option>
          {AGENTS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label={t('Status')}
          className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
        >
          <option value="">{t('Alla statusar')}</option>
          {['new', 'in_progress', 'waiting_ai', 'review', 'sent', 'closed'].map((s) => (
            <option key={s} value={s}>{statusLabelSv(s)}</option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          aria-label={t('Prioritet')}
          className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
        >
          <option value="">{t('Alla prioriteter')}</option>
          {['urgent', 'high', 'normal', 'low'].map((p) => (
            <option key={p} value={p}>{priorityLabelSv(p)}</option>
          ))}
        </select>
        {filtersActive && (
          <button
            onClick={() => { setFilterAgent(''); setFilterStatus(''); setFilterPriority(''); }}
            className="text-xs text-[#7C5CFF] hover:underline"
          >
            {t('Rensa filter')}
          </button>
        )}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('Totalt antal ärenden')}</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">{data.totalTickets}</p>
            </div>
            <div className="w-12 h-12 rounded-lg border border-blue-300 dark:border-blue-700 flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('Lösta idag')}</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">{data.resolvedToday}</p>
            </div>
            <div className="w-12 h-12 rounded-lg border border-green-300 dark:border-green-700 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('Väntande')}</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">{data.pendingTickets}</p>
            </div>
            <div className="w-12 h-12 rounded-lg border border-yellow-300 dark:border-yellow-700 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
            </div>
          </div>
        </div>

        {/* Median (not mean) response time — the mean was dragged to ~48h by
            tickets left over weekends; median is the honest headline. */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('Median svarstid')}</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">{data.medianResponseTime}h</p>
              <p className="text-[11px] text-slate-400 mt-1">{t('snitt')} {data.avgResponseTime}h</p>
            </div>
            <div className="w-12 h-12 rounded-lg border border-purple-300 dark:border-purple-700 flex items-center justify-center">
              <Clock className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </div>

        {/* First response time — from the event log, so it survives
            follow-up replies overwriting sentAt. Fills from go-live +
            backfill; '–' until there is data. */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('Första svarstid')}</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                {data.firstResponse && data.firstResponse.count > 0 ? `${data.firstResponse.medianHours}h` : '–'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                {data.firstResponse && data.firstResponse.count > 0
                  ? data.firstResponse.basis === 'business'
                    ? `${t('median (öppettid)')} · p90 ${data.firstResponse.p90Hours}h · ${t('kalender')} ${data.firstResponse.medianHoursCalendar}h`
                    : `${t('median')} · p90 ${data.firstResponse.p90Hours}h · ${data.firstResponse.count} ${t('ärenden')}`
                  : t('Första svaret per ärende')}
              </p>
            </div>
            <div className="w-12 h-12 rounded-lg border border-sky-300 dark:border-sky-700 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-sky-600 dark:text-sky-400" />
            </div>
          </div>
        </div>

        {/* Active work time per ticket — real "time inside the ticket" from
            presence, NOT the queue-inclusive workStartedAt→sentAt span. */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('Aktiv arbetstid / ärende')}</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
                {activeWork && activeWork.count > 0 ? fmtMinutes(activeWork.medianMinutes) : '–'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                {activeWork && activeWork.count > 0
                  ? `${t('median, baserat på')} ${activeWork.count} ${t('ärenden')}`
                  : t('Mäts från faktisk närvaro i ärendet')}
              </p>
            </div>
            <div className="w-12 h-12 rounded-lg border border-[#7C5CFF]/40 flex items-center justify-center">
              <Timer className="w-6 h-6 text-[#7C5CFF]" />
            </div>
          </div>
        </div>
      </div>

      {/* ── SLA vs the configured first-response target ─────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('SLA: första svar inom mål')}</h3>
          </div>
          {filtersActive && (
            <span className="text-[11px] text-slate-400">{t('Filter påverkar inte denna panel')}</span>
          )}
        </div>
        {data.sla ? (
          <>
            <div className="flex items-baseline gap-2 mt-2">
              <span className={`text-4xl font-bold ${
                data.sla.attainmentPct == null ? 'text-slate-400'
                : data.sla.attainmentPct >= 90 ? 'text-emerald-600 dark:text-emerald-400'
                : data.sla.attainmentPct >= 70 ? 'text-amber-600 dark:text-amber-400'
                : 'text-red-500'
              }`}>
                {data.sla.attainmentPct != null ? `${data.sla.attainmentPct}%` : '–'}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {t('inom målet')} {data.sla.targetHours}h{data.sla.basis === 'business' ? ` (${t('öppettid')})` : ''}
              </span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              {data.sla.met} {t('av')} {data.sla.answered} {t('besvarade ärenden i perioden fick första svar inom målet.')}
            </p>
            {data.sla.openOverdue.count > 0 ? (
              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">
                  {data.sla.openOverdue.count} {t('öppna ärenden har passerat målet utan svar:')}
                </p>
                <ul className="space-y-1">
                  {data.sla.openOverdue.tickets.map((ov) => (
                    <li key={ov.id} className="text-sm">
                      <a
                        href={`/tickets?ticket=${ov.id}`}
                        className="text-[#7C5CFF] hover:underline"
                      >
                        {ov.subject || t('(utan ämne)')}
                      </a>
                      <span className="text-xs text-slate-400 ml-2">
                        {(() => {
                          // Long waits read best in calendar days regardless
                          // of basis; short ones in hours of the active basis.
                          const calendar = ov.ageHoursCalendar ?? ov.ageHours;
                          if (calendar >= 48) return `${Math.round(calendar / 24)} ${t('dygn')} ${t('gammalt')}`;
                          return data.sla?.basis === 'business'
                            ? `${ov.ageHours}h ${t('öppettid')}`
                            : `${ov.ageHours}h ${t('gammalt')}`;
                        })()}
                      </span>
                    </li>
                  ))}
                  {data.sla.openOverdue.count > data.sla.openOverdue.tickets.length && (
                    <li className="text-xs text-slate-400">
                      +{data.sla.openOverdue.count - data.sla.openOverdue.tickets.length} {t('till')}
                    </li>
                  )}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-3">
                {t('Inga öppna ärenden har passerat målet utan svar.')}
              </p>
            )}
          </>
        ) : (
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            <p>{t('Sätt ett SLA-mål (t.ex. svar inom 24 timmar) för att följa upp hur stor andel av ärendena som besvaras i tid.')}</p>
            <button
              onClick={() => setEditingRoi(true)}
              className="mt-3 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
            >
              {t('Sätt SLA-mål')}
            </button>
          </div>
        )}
      </div>

      {/* ── Section 1: ROI / value ──────────────────────────────────────── */}
      {savings && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Värde: tid & pengar sparade')}</h3>
            </div>
            <div className="flex items-center gap-3">
              {(filterStatus || filterPriority) && (
                <span className="text-[11px] text-slate-400">{t('Status-/prioritetsfilter påverkar inte denna panel')}</span>
              )}
              <button
                onClick={() => setEditingRoi((v) => !v)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                <Settings className="w-3.5 h-3.5" /> {t('Inställningar')}
              </button>
            </div>
          </div>

          {savings.moneySaved != null ? (
            <>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">
                  {savings.moneySaved.toLocaleString('sv-SE')} kr
                </span>
                <span className="text-sm text-slate-500 dark:text-slate-400">{t('uppskattat sparat i vald period')}</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-3">
                {savings.savedMinutesPerTicket} {t('min sparat per ärende')} × {savings.ticketsHandled} {t('ärenden')} ≈ {savings.savedHours} {t('timmar')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t('Före verktyget')}: {savings.baselineHandlingMinutes} {t('min/ärende')} → {t('nu')}: {savings.activeWorkMedianMinutes} {t('min aktiv arbetstid')} ({t('timkostnad')} {savings.agentHourlyCost} kr)
                {savings.baselineSource === 'no_ai_group' && ` · ${t('baslinje uppskattad från ärenden utan AI')}`}
              </p>
            </>
          ) : (
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              <p>{t('För att visa sparad tid och pengar behövs:')}</p>
              <ul className="list-disc ml-5 mt-1 space-y-0.5">
                {savings.baselineHandlingMinutes == null && <li>{t('Tid per ärende före verktyget (min)')}</li>}
                {savings.agentHourlyCost == null && <li>{t('Timkostnad för en agent (kr)')}</li>}
                {savings.activeWorkSampleCount < 10 && (
                  <li>{t('Fler ärenden med uppmätt aktiv arbetstid')} ({savings.activeWorkSampleCount}/10)</li>
                )}
              </ul>
              {!editingRoi && (
                <button
                  onClick={() => setEditingRoi(true)}
                  className="mt-3 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                >
                  {t('Ange baslinje & timkostnad')}
                </button>
              )}
            </div>
          )}

          {editingRoi && (
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('Tid/ärende före verktyget (min)')}</label>
                <input
                  type="number" min="0" inputMode="decimal"
                  value={roiDraft.baselineHandlingMinutes}
                  onChange={(e) => setRoiDraft((d) => ({ ...d, baselineHandlingMinutes: e.target.value }))}
                  placeholder={t('t.ex. 15')}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('Timkostnad agent (kr)')}</label>
                <input
                  type="number" min="0" inputMode="decimal"
                  value={roiDraft.agentHourlyCost}
                  onChange={(e) => setRoiDraft((d) => ({ ...d, agentHourlyCost: e.target.value }))}
                  placeholder={t('t.ex. 300')}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">{t('SLA-mål: första svar inom (timmar)')}</label>
                <input
                  type="number" min="0" inputMode="decimal"
                  value={roiDraft.slaFirstResponseHours}
                  onChange={(e) => setRoiDraft((d) => ({ ...d, slaFirstResponseHours: e.target.value }))}
                  placeholder={t('t.ex. 24')}
                  title={t('Räknas i öppettid när öppettider är angivna (Bemanning → Antaganden), annars i kalendertimmar')}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm"
                />
              </div>
              <button
                onClick={saveRoiSettings}
                disabled={savingRoi}
                className="px-4 py-2 rounded-md bg-[#7C5CFF] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50"
              >
                {savingRoi ? t('Sparar…') : t('Spara')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Section 2: how much does the AI actually do? ────────────────── */}
      {editStats && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-1">
            <PencilLine className="w-5 h-5 text-[#7C5CFF]" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Hur mycket bygger svaren på AI-utkastet?')}</h3>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {t('Andel av det skickade svaret som kommer från AI-utkastet (ordöverlapp – nedkortning räknas som behållet). Bör stiga över tid.')}
          </p>
          {editStats.count === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('Ingen data ännu – mäts på svar som hade ett AI-utkast.')}</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">{editStats.medianKeptPct}%</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">{t('av det skickade svaret kommer från AI-utkastet (median)')}</span>
              </div>
              {([
                { label: t('Skickat ~som AI-utkastet (<10% nytt)'), value: editStats.unchanged, color: 'bg-emerald-500' },
                { label: t('Byggt på AI-utkastet (10–50% nytt)'), value: editStats.light, color: 'bg-amber-500' },
                { label: t('Mestadels nyskrivet (>50% nytt)'), value: editStats.heavy, color: 'bg-slate-400' },
              ] as const).map(({ label, value, color }) => (
                <div key={label} className="mb-2.5">
                  <div className="flex items-center justify-between mb-1 text-xs text-slate-600 dark:text-slate-400">
                    <span>{label}</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{value}</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${(value / editStats.count) * 100}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-slate-400 mt-3">{t('Baserat på')} {editStats.count} {t('svar med AI-utkast.')}</p>

              {/* Drill-down: the actual rewritten replies, draft vs sent.
                  This is the working list for fixing the AI — each row shows
                  what the draft missed and what the right answer was. */}
              {editStats.heavy > 0 && (
                <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-4">
                  <button
                    onClick={() => setShowRewritten((v) => !v)}
                    className="text-sm font-medium text-[#7C5CFF] hover:underline"
                  >
                    {showRewritten
                      ? t('Dölj omskrivna svar')
                      : `${t('Visa omskrivna svar')} (${editStats.heavy})`}
                  </button>

                  {showRewritten && (
                    <div className="mt-3 space-y-2">
                      {loadingRewritten && (
                        <p className="text-sm text-slate-500 dark:text-slate-400">{t('Laddar…')}</p>
                      )}
                      {!loadingRewritten && rewritten && rewritten.length === 0 && (
                        <p className="text-sm text-slate-500 dark:text-slate-400">{t('Inga omskrivna svar i perioden.')}</p>
                      )}
                      {!loadingRewritten && rewritten && rewritten.map((item) => {
                        const isOpen = expandedRewritten === item.ticketId;
                        return (
                          <div key={item.ticketId} className="rounded-lg border border-slate-200 dark:border-slate-700">
                            <button
                              onClick={() => setExpandedRewritten(isOpen ? null : item.ticketId)}
                              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg"
                            >
                              <span className="shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                {item.keptPct}% {t('behållet')}
                              </span>
                              <span className="flex-1 min-w-0 truncate text-sm text-slate-800 dark:text-slate-200">{item.subject}</span>
                              <span className="shrink-0 text-xs text-slate-400">
                                {item.sentAt ? new Date(item.sentAt).toLocaleDateString('sv-SE') : ''}
                                {item.sentBy ? ` · ${item.sentBy.split('@')[0].split(' ')[0]}` : ''}
                              </span>
                            </button>
                            {isOpen && (
                              <div className="px-3 pb-3 space-y-3">
                                {item.question && (
                                  <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{t('Kundens fråga')}</p>
                                    <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-32 overflow-y-auto">{item.question}</p>
                                  </div>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="rounded-md border border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20 p-2.5">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-500 dark:text-rose-400 mb-1">{t('AI-utkastet (skickades inte)')}</p>
                                    <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto">{item.aiDraft}</p>
                                  </div>
                                  <div className="rounded-md border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 mb-1">{t('Skickat svar')}</p>
                                    <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto">{item.sentReply}</p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Response time with vs without AI — only the medians, with a small-n
          guard on the comparative claim. */}
      {aiComparison && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-[#7C5CFF]" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Svarstid med vs utan AI-utkast')}</h3>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {t('Median svarstid per ärende, med samma indelning som ovan plus ärenden utan AI-utkast.')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {([
              { key: 'fromAi', label: t('~som AI-utkastet'), g: aiComparison.fromAi, accent: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
              { key: 'builtOn', label: t('Byggt på AI-utkastet'), g: aiComparison.builtOn, accent: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
              { key: 'mostlyNew', label: t('Mestadels nyskrivet'), g: aiComparison.mostlyNew, accent: 'text-slate-600 dark:text-slate-300', dot: 'bg-slate-400' },
              { key: 'none', label: t('Utan AI-utkast'), g: aiComparison.none, accent: 'text-slate-600 dark:text-slate-300', dot: 'bg-slate-300' },
            ] as const).map(({ key, label, g, accent, dot }) => (
              <div key={key} className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
                </div>
                <p className={`text-2xl font-bold ${accent}`}>
                  {g.count > 0 ? `${g.responseMedian} h` : '–'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{g.count} {t('ärenden')}</p>
              </div>
            ))}
          </div>
          {aiComparison.fromAi.count >= MIN_GROUP && aiComparison.none.count >= MIN_GROUP && aiComparison.none.responseMedian > aiComparison.fromAi.responseMedian ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-4 font-medium">
              {t('Svar som skickas ~som AI-utkastet besvaras')} {Math.round((1 - aiComparison.fromAi.responseMedian / aiComparison.none.responseMedian) * 100)}% {t('snabbare än ärenden utan AI-stöd.')}
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-4">
              {t('För få ärenden i någon grupp för en säker jämförelse (kräver minst')} {MIN_GROUP} {t('per grupp).')}
            </p>
          )}
        </div>
      )}

      {/* Active time detail panel */}
      {activeWork && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-1">
            <MousePointerClick className="w-5 h-5 text-[#7C5CFF]" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Faktisk aktiv arbetstid per ärende')}</h3>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {t('Tid en agent faktiskt är inne i ärendet, mätt från närvaro (inte total liggtid).')}
          </p>
          {activeWork.count === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('Ingen data ännu – mäts framåt medan agenter arbetar i ärenden.')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-3xl font-bold text-[#7C5CFF]">{fmtMinutes(activeWork.medianMinutes)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('median')}</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{fmtMinutes(activeWork.avgMinutes)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('snitt')}</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{activeWork.count}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('ärenden mätta')}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Section 3: trend & operations ───────────────────────────────── */}
      {trend.length > 1 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Utveckling över tid')}</h3>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {t('Median per period. Lägre är bättre – följ riktningen över tid.')}
          </p>
          {([
            { title: t('Svarstid (timmar)'), pick: (p: typeof trend[number]) => p.responseMedian, suffix: 'h', color: 'from-purple-500 to-purple-400' },
            { title: t('Aktiv arbetstid (min)'), pick: (p: typeof trend[number]) => p.handlingMedian, suffix: 'min', color: 'from-[#7C5CFF] to-[#9F7BFF]' },
          ] as const)
            .filter(({ pick }) => trend.some((p) => pick(p) > 0))
            .map(({ title, pick, suffix, color }) => {
            const max = Math.max(1, ...trend.map(pick));
            const first = pick(trend[0]);
            const last = pick(trend[trend.length - 1]);
            const delta = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
            return (
              <div key={title} className="mb-6 last:mb-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</span>
                  {first > 0 && (
                    <span className={`text-xs font-semibold ${delta < 0 ? 'text-emerald-600 dark:text-emerald-400' : delta > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {delta > 0 ? '+' : ''}{delta}% {delta < 0 ? t('↓ snabbare') : delta > 0 ? t('↑ långsammare') : ''}
                    </span>
                  )}
                </div>
                <div className="flex items-end justify-between gap-1 sm:gap-2">
                  {trend.map((point, i) => {
                    const val = pick(point);
                    const height = val === 0 ? 2 : Math.max((val / max) * 100, 4);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center min-w-0">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">{val || '–'}</span>
                        <div className="w-full h-28 flex items-end justify-center">
                          <div
                            className={`w-full rounded-t-md transition-all hover:brightness-110 ${val === 0 ? 'bg-slate-200 dark:bg-slate-700' : `bg-gradient-to-t ${color}`}`}
                            style={{ height: `${height}%` }}
                            title={`${point.label}: ${val} ${suffix} (${point.count} ${t('ärenden')})`}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 truncate w-full text-center">{point.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Per-user stats with share of all replies + key-person flag */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-[#7C5CFF]" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Ärenden per medarbetare')}</h3>
        </div>
        {topShare >= KEY_PERSON_SHARE && topAgent && (
          <div className="mb-4 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
            {t('Nyckelpersonsrisk:')} {topAgent.name} {t('står för')} {Math.round(topShare * 100)}% {t('av alla skickade svar.')}
          </div>
        )}
        {perUserStats.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('Ingen statistik tillgänglig ännu. Tilldela eller skicka ärenden för att börja följa upp.')}
          </p>
        ) : (
          <div className="space-y-4">
            {perUserStats.map((agent) => {
              const share = data.totalSent > 0 ? Math.round((agent.sent / data.totalSent) * 100) : 0;
              return (
                <div key={agent.name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-[#7C5CFF]/15 text-[#7C5CFF] dark:text-[#B8A6FF] flex items-center justify-center text-xs font-bold">
                        {agent.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{agent.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{agent.assigned}</span>
                        <span>{t('tilldelade')}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Send className="w-3.5 h-3.5" />
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{agent.sent}</span>
                        <span>{t('skickade')}</span>
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden flex">
                    <div
                      className="bg-[#7C5CFF] h-2 transition-all"
                      style={{ width: `${(agent.assigned / maxAgentTotal) * 100}%` }}
                      title={`${t('Tilldelade:')} ${agent.assigned}`}
                    />
                    <div
                      className="bg-green-500 h-2 transition-all"
                      style={{ width: `${(agent.sent / maxAgentTotal) * 100}%` }}
                      title={`${t('Skickade:')} ${agent.sent}`}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">{share}% {t('av skickade svar')}</p>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-[#7C5CFF]" /> {t('Tilldelade')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-green-500" /> {t('Skickade')}
          </span>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">{t('Senaste aktivitet')}</h3>
        {(() => {
          const activity = data.recentActivity || [];
          const maxCount = activity.reduce((m, d) => Math.max(m, d.count), 0);
          const totalInRange = activity.reduce((s, d) => s + d.count, 0);
          const hourly = data.activityInterval === 'hour';

          if (activity.length === 0 || totalInRange === 0) {
            return (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('Ingen aktivitet i vald tidsperiod.')}</p>
            );
          }

          const formatLabel = (iso: string) =>
            hourly
              ? new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
              : new Date(iso).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' });

          const tooltipFor = (iso: string, count: number) =>
            `${formatLabel(iso)} – ${count} ${t('ärenden')}`;

          const labelEvery = hourly
            ? 3
            : activity.length > 31 ? 7
            : activity.length > 14 ? 3
            : 1;
          const showLabel = (index: number) =>
            index % labelEvery === 0 || index === activity.length - 1;

          return (
            <div>
              {/* All bars live in one fixed-height track, bottom-aligned, with
                  an explicit baseline border — so every bar unmistakably starts
                  at the same line. Exact counts are in the hover tooltip. */}
              <div className="flex items-end justify-between gap-1 sm:gap-2 h-48 border-b border-slate-200 dark:border-slate-700">
                {activity.map((point, index) => {
                  const ratio = maxCount > 0 ? point.count / maxCount : 0;
                  const height = point.count === 0 ? 1.5 : Math.max(ratio * 100, 4);
                  return (
                    <div
                      key={index}
                      className="flex-1 flex items-end h-full min-w-0"
                      title={tooltipFor(point.date, point.count)}
                    >
                      <div
                        className={`w-full rounded-t-md transition-all hover:brightness-110 ${
                          point.count === 0
                            ? 'bg-slate-200 dark:bg-slate-700'
                            : 'bg-gradient-to-t from-[#7C5CFF] to-[#9F7BFF]'
                        }`}
                        style={{ height: `${height}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between gap-1 sm:gap-2 mt-2">
                {activity.map((point, index) => (
                  <span
                    key={index}
                    className="flex-1 text-[10px] text-slate-500 dark:text-slate-400 truncate text-center min-w-0"
                  >
                    {showLabel(index) ? formatLabel(point.date) : ''}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Volume heatmap: weekday × hour. The pattern here is what the
          bemanning page turns into a staffing recommendation. */}
      {data.heatmap && data.heatmap.some((row) => row.some((c) => c > 0)) && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-5 h-5 text-[#7C5CFF]" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Volym per veckodag och timme')}</h3>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {t('Antal inkomna ärenden per timme (svensk tid) i vald period. Mörkare = fler ärenden.')}
          </p>
          {(() => {
            const heatmap = data.heatmap!;
            const weekdays = [t('Mån'), t('Tis'), t('Ons'), t('Tor'), t('Fre'), t('Lör'), t('Sön')];
            const max = Math.max(1, ...heatmap.flat());
            return (
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  {heatmap.map((row, wd) => (
                    <div key={wd} className="flex items-center gap-1 mb-1">
                      <span className="w-10 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{weekdays[wd]}</span>
                      {row.map((count, hour) => (
                        <div
                          key={hour}
                          title={`${weekdays[wd]} ${String(hour).padStart(2, '0')}:00 – ${count} ${t('ärenden')}`}
                          className={`h-5 flex-1 rounded-sm ${count === 0 ? 'bg-slate-100 dark:bg-slate-700/40' : ''}`}
                          style={count > 0 ? { backgroundColor: `rgba(124, 92, 255, ${0.15 + 0.85 * (count / max)})` } : undefined}
                        />
                      ))}
                    </div>
                  ))}
                  <div className="flex items-center gap-1 mt-1">
                    <span className="w-10 shrink-0" />
                    {Array.from({ length: 24 }, (_, hour) => (
                      <span key={hour} className="flex-1 text-center text-[9px] text-slate-400">
                        {hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Backlog: open tickets at the end of each day. */}
      {data.backlog && data.backlog.length > 1 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-[#7C5CFF]" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Ärendebalans (backlogg)')}</h3>
            </div>
            {filtersActive && (
              <span className="text-[11px] text-slate-400">{t('Filter påverkar inte denna panel')}</span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {t('Antal öppna ärenden vid varje dags slut. Stigande balans betyder att det kommer in mer än teamet hinner besvara.')}
          </p>
          {(() => {
            const backlog = data.backlog!;
            const maxOpen = Math.max(1, ...backlog.map((b) => b.open));
            const labelEvery = backlog.length > 31 ? 7 : backlog.length > 14 ? 3 : 1;
            return (
              <div>
                <div className="flex items-end justify-between gap-1 sm:gap-2 h-40 border-b border-slate-200 dark:border-slate-700">
                  {backlog.map((point, index) => {
                    const height = point.open === 0 ? 1.5 : Math.max((point.open / maxOpen) * 100, 4);
                    return (
                      <div
                        key={index}
                        className="flex-1 flex items-end h-full min-w-0"
                        title={`${point.date} – ${point.open} ${t('öppna')}${point.approximate ? ` (${t('uppskattat')})` : ''}`}
                      >
                        <div
                          className={`w-full rounded-t-md transition-all hover:brightness-110 ${
                            point.open === 0
                              ? 'bg-slate-200 dark:bg-slate-700'
                              : point.approximate
                                ? 'bg-gradient-to-t from-slate-400 to-slate-300 dark:from-slate-600 dark:to-slate-500'
                                : 'bg-gradient-to-t from-amber-500 to-amber-400'
                          }`}
                          style={{ height: `${height}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between gap-1 sm:gap-2 mt-2">
                  {backlog.map((point, index) => (
                    <span key={index} className="flex-1 text-[10px] text-slate-500 dark:text-slate-400 truncate text-center min-w-0">
                      {index % labelEvery === 0 || index === backlog.length - 1
                        ? new Date(point.date).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' })
                        : ''}
                    </span>
                  ))}
                </div>
                {backlog.some((b) => b.approximate) && (
                  <p className="text-[11px] text-slate-400 mt-2">
                    {t('Grå staplar är uppskattade — de ligger före händelseloggens start och bygger på ungefärliga stängningstider.')}
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Replies per ticket: how many rounds a case takes. */}
      {data.repliesPerTicket && data.repliesPerTicket.ticketCount > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-5 h-5 text-[#7C5CFF]" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Svar per ärende')}</h3>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {t('Hur många svar en konversation kräver. Många fleromgångsärenden kan tyda på att första svaret inte löser frågan.')}
          </p>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl font-bold text-[#7C5CFF]">{data.repliesPerTicket.avg}</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">{t('svar per ärende i snitt')}</span>
          </div>
          {([
            { label: t('Löst med 1 svar'), value: data.repliesPerTicket.distribution.one, color: 'bg-emerald-500' },
            { label: t('2 svar'), value: data.repliesPerTicket.distribution.two, color: 'bg-amber-500' },
            { label: t('3 eller fler svar'), value: data.repliesPerTicket.distribution.threePlus, color: 'bg-slate-400' },
          ] as const).map(({ label, value, color }) => (
            <div key={label} className="mb-2.5">
              <div className="flex items-center justify-between mb-1 text-xs text-slate-600 dark:text-slate-400">
                <span>{label}</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{value}</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${(value / data.repliesPerTicket!.ticketCount) * 100}%` }} />
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-400 mt-3">{t('Baserat på')} {data.repliesPerTicket.ticketCount} {t('ärenden med minst ett svar i perioden.')}</p>
        </div>
      )}
    </div>
  );
}
