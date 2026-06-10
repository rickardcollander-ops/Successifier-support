'use client';

import { useState, useEffect } from 'react';
import { BarChart3, Clock, CheckCircle, AlertCircle, Users, Send, Timer, TrendingDown, Sparkles } from 'lucide-react';
import { statusLabelSv, priorityLabelSv } from '@/lib/constants';
import { t } from '@/lib/i18n';

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

interface ReportData {
  totalTickets: number;
  ticketsByStatus: Record<string, number>;
  ticketsByPriority: Record<string, number>;
  avgResponseTime: number;
  avgHandlingMinutes?: number;
  handledCount?: number;
  resolvedToday: number;
  pendingTickets: number;
  recentActivity: Array<{
    date: string;
    count: number;
  }>;
  activityInterval?: 'hour' | 'day';
  perUserStats?: AgentStats[];
  trend?: Array<{
    label: string;
    responseMedian: number;
    handlingMedian: number;
    count: number;
  }>;
  aiComparison?: {
    asIs: GroupStats;
    edited: GroupStats;
    none: GroupStats;
  };
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'1d' | '7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    fetchReportData();
  }, [timeRange]);

  const fetchReportData = async () => {
    try {
      const response = await fetch(`/api/reports?range=${timeRange}`);
      if (response.ok) {
        const reportData = await response.json();
        setData(reportData);
      }
    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setLoading(false);
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-blue-500';
      case 'in_progress': return 'bg-yellow-500';
      case 'review': return 'bg-purple-500';
      case 'sent': return 'bg-green-500';
      case 'closed': return 'bg-slate-500';
      default: return 'bg-slate-500';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'normal': return 'bg-blue-500';
      case 'low': return 'bg-slate-500';
      default: return 'bg-slate-500';
    }
  };

  // Active handling time comes from the API in minutes; show it in whichever
  // unit reads cleanest. "–" while no worked-and-sent tickets exist yet so an
  // empty POC doesn't claim "0 min" handling time.
  const formatHandlingTime = (): string => {
    const minutes = data.avgHandlingMinutes ?? 0;
    if (!data.handledCount || minutes <= 0) return '–';
    if (minutes < 60) return `${minutes} min`;
    return `${Math.round((minutes / 60) * 10) / 10} h`;
  };

  // Shared minute formatter for the comparison/trend panels.
  const fmtMinutes = (minutes: number): string => {
    if (!minutes || minutes <= 0) return '–';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    return `${Math.round((minutes / 60) * 10) / 10} h`;
  };
  const trend = data.trend || [];
  const aiComparison = data.aiComparison;

  const perUserStats = data.perUserStats || [];
  const maxAgentTotal = Math.max(
    1,
    ...perUserStats.map((s) => s.assigned + s.sent)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t('Rapporter')}</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">{t('Statistik och analys')}</p>
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as any)}
          className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
        >
          <option value="1d">{t('Senaste dygnet')}</option>
          <option value="7d">{t('Senaste 7 dagarna')}</option>
          <option value="30d">{t('Senaste 30 dagarna')}</option>
          <option value="90d">{t('Senaste 90 dagarna')}</option>
        </select>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
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

        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('Genomsnittlig svarstid')}</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">{data.avgResponseTime}h</p>
            </div>
            <div className="w-12 h-12 rounded-lg border border-purple-300 dark:border-purple-700 flex items-center justify-center">
              <Clock className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('Genomsnittlig handläggningstid')}</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">{formatHandlingTime()}</p>
              <p className="text-[11px] text-slate-400 mt-1">
                {data.handledCount
                  ? `${t('Aktiv arbetstid per ärende, baserat på')} ${data.handledCount} ${t('ärenden')}`
                  : t('Mäts från påbörjat arbete till skickat svar')}
              </p>
            </div>
            <div className="w-12 h-12 rounded-lg border border-[#7C5CFF]/40 flex items-center justify-center">
              <Timer className="w-6 h-6 text-[#7C5CFF]" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Value case: with vs without AI (response time) ──────────────── */}
      {aiComparison && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-[#7C5CFF]" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Svarstid med vs utan AI-utkast')}</h3>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {t('Median svarstid per ärende, uppdelat på hur AI-utkastet användes.')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {([
              { key: 'asIs', label: t('AI-utkast skickat ~oförändrat'), g: aiComparison.asIs, accent: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
              { key: 'edited', label: t('AI-utkast omskrivet'), g: aiComparison.edited, accent: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
              { key: 'none', label: t('Utan AI-utkast'), g: aiComparison.none, accent: 'text-slate-600 dark:text-slate-300', dot: 'bg-slate-400' },
            ] as const).map(({ key, label, g, accent, dot }) => (
              <div key={key} className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
                </div>
                <p className={`text-2xl font-bold ${accent}`}>
                  {g.count > 0 ? `${g.responseMedian} h` : '–'}
                </p>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 space-y-0.5">
                  <p>{g.count} {t('ärenden')}</p>
                  {g.handledCount > 0 && <p>{t('handläggningstid median:')} {fmtMinutes(g.handlingMedian)}</p>}
                </div>
              </div>
            ))}
          </div>
          {aiComparison.asIs.count > 0 && aiComparison.none.count > 0 && aiComparison.none.responseMedian > aiComparison.asIs.responseMedian && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-4 font-medium">
              {t('AI-utkast som skickas oförändrat besvaras')} {Math.round((1 - aiComparison.asIs.responseMedian / aiComparison.none.responseMedian) * 100)}% {t('snabbare än ärenden utan AI-stöd.')}
            </p>
          )}
        </div>
      )}

      {/* ── Value case: trend over time ─────────────────────────────────── */}
      {trend.length > 1 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Utveckling över tid')}</h3>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {t('Median per period – en nedåtgående kurva visar att verktyget kortar tiderna.')}
          </p>
          {([
            { title: t('Svarstid (timmar)'), pick: (p: typeof trend[number]) => p.responseMedian, suffix: 'h', color: 'from-purple-500 to-purple-400' },
            { title: t('Handläggningstid (min)'), pick: (p: typeof trend[number]) => p.handlingMedian, suffix: 'min', color: 'from-[#7C5CFF] to-[#9F7BFF]' },
          ] as const)
            // Only render a series that actually has data — handling time is
            // empty until tickets accrue a workStartedAt, and an all-"–" row
            // just looks broken.
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

      {/* Per-user stats (always visible, even if zero) */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-[#7C5CFF]" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Ärenden per medarbetare')}</h3>
        </div>
        {perUserStats.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('Ingen statistik tillgänglig ännu. Tilldela eller skicka ärenden för att börja följa upp.')}
          </p>
        ) : (
          <div className="space-y-4">
            {perUserStats.map((agent) => {
              const total = agent.assigned + agent.sent;
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
                  <p className="text-[10px] text-slate-400 mt-1">{t('Totalt:')} {total}</p>
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

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tickets by Status */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">{t('Ärenden per status')}</h3>
          <div className="space-y-3">
            {Object.entries(data.ticketsByStatus).map(([status, count]) => (
              <div key={status}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    {statusLabelSv(status)}
                  </span>
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{count}</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div
                    className={`${getStatusColor(status)} h-2 rounded-full transition-all`}
                    style={{ width: `${(count / data.totalTickets) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tickets by Priority */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">{t('Ärenden per prioritet')}</h3>
          <div className="space-y-3">
            {Object.entries(data.ticketsByPriority).map(([priority, count]) => (
              <div key={priority}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-slate-600 dark:text-slate-400">{priorityLabelSv(priority)}</span>
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{count}</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div
                    className={`${getPriorityColor(priority)} h-2 rounded-full transition-all`}
                    style={{ width: `${(count / data.totalTickets) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
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
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('Ingen aktivitet i vald tidsperiod.')}
              </p>
            );
          }

          const formatLabel = (iso: string) =>
            hourly
              ? new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
              : new Date(iso).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' });

          const tooltipFor = (iso: string, count: number) =>
            `${formatLabel(iso)} – ${count} ${t('ärenden')}`;

          // With many bars (24 hours, 30/90 days) labelling every bar makes
          // the axis an unreadable smear. Label every Nth bucket plus the
          // last one; short ranges still label everything.
          const labelEvery = hourly
            ? 3
            : activity.length > 31 ? 7
            : activity.length > 14 ? 3
            : 1;
          const showLabel = (index: number) =>
            index % labelEvery === 0 || index === activity.length - 1;
          // The per-bar count on top only fits up to ~a month of bars; for
          // 90 days the hover tooltip carries the exact number instead.
          const showCounts = activity.length <= 31;

          return (
            <div className="flex items-end justify-between gap-1 sm:gap-2">
              {activity.map((point, index) => {
                // Baseline of 2% so bars are still visible on zero-count
                // buckets (makes it clear the chart rendered, not just broke).
                const ratio = point.count / maxCount;
                const height = point.count === 0 ? 2 : Math.max(ratio * 100, 4);
                return (
                  <div key={index} className="flex-1 flex flex-col items-center min-w-0">
                    {showCounts && (
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                        {point.count}
                      </span>
                    )}
                    {/* Fixed-height bar area: the percentage heights below
                        need a definite parent height to resolve against —
                        with the old auto-height column + h-full chain they
                        collapsed to 0 and the chart rendered empty. */}
                    <div className="w-full h-48 flex items-end justify-center">
                      <div
                        className={`w-full rounded-t-lg transition-all hover:brightness-110 ${
                          point.count === 0
                            ? 'bg-slate-200 dark:bg-slate-700'
                            : 'bg-gradient-to-t from-[#7C5CFF] to-[#9F7BFF]'
                        }`}
                        style={{ height: `${height}%` }}
                        title={tooltipFor(point.date, point.count)}
                      />
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-400 mt-2 truncate w-full text-center">
                      {showLabel(index) ? formatLabel(point.date) : ' '}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
