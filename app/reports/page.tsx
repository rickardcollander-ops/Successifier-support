'use client';

import { useState, useEffect } from 'react';
import { BarChart3, Clock, CheckCircle, AlertCircle, Users, Send } from 'lucide-react';
import { statusLabelSv, priorityLabelSv } from '@/lib/constants';

interface AgentStats {
  name: string;
  assigned: number;
  sent: number;
}

interface ReportData {
  totalTickets: number;
  ticketsByStatus: Record<string, number>;
  ticketsByPriority: Record<string, number>;
  avgResponseTime: number;
  resolvedToday: number;
  pendingTickets: number;
  recentActivity: Array<{
    date: string;
    count: number;
  }>;
  activityInterval?: 'hour' | 'day';
  perUserStats?: AgentStats[];
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
        <div className="text-slate-600 dark:text-slate-400">Laddar rapporter…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Ingen data tillgänglig</div>
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Rapporter</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">Statistik och analys</p>
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as any)}
          className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
        >
          <option value="1d">Senaste dygnet</option>
          <option value="7d">Senaste 7 dagarna</option>
          <option value="30d">Senaste 30 dagarna</option>
          <option value="90d">Senaste 90 dagarna</option>
        </select>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Totalt antal ärenden</p>
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
              <p className="text-sm text-slate-600 dark:text-slate-400">Lösta idag</p>
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
              <p className="text-sm text-slate-600 dark:text-slate-400">Väntande</p>
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
              <p className="text-sm text-slate-600 dark:text-slate-400">Genomsnittlig svarstid</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">{data.avgResponseTime}h</p>
            </div>
            <div className="w-12 h-12 rounded-lg border border-purple-300 dark:border-purple-700 flex items-center justify-center">
              <Clock className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Per-user stats (always visible, even if zero) */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-[#7C5CFF]" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Ärenden per medarbetare</h3>
        </div>
        {perUserStats.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Ingen statistik tillgänglig ännu. Tilldela eller skicka ärenden för att börja följa upp.
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
                        <span>tilldelade</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Send className="w-3.5 h-3.5" />
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{agent.sent}</span>
                        <span>skickade</span>
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden flex">
                    <div
                      className="bg-[#7C5CFF] h-2 transition-all"
                      style={{ width: `${(agent.assigned / maxAgentTotal) * 100}%` }}
                      title={`Tilldelade: ${agent.assigned}`}
                    />
                    <div
                      className="bg-green-500 h-2 transition-all"
                      style={{ width: `${(agent.sent / maxAgentTotal) * 100}%` }}
                      title={`Skickade: ${agent.sent}`}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Totalt: {total}</p>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-[#7C5CFF]" /> Tilldelade
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-green-500" /> Skickade
          </span>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tickets by Status */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Ärenden per status</h3>
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
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Ärenden per prioritet</h3>
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
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Senaste aktivitet</h3>
        {(() => {
          const activity = data.recentActivity || [];
          const maxCount = activity.reduce((m, d) => Math.max(m, d.count), 0);
          const totalInRange = activity.reduce((s, d) => s + d.count, 0);
          const hourly = data.activityInterval === 'hour';

          if (activity.length === 0 || totalInRange === 0) {
            return (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Ingen aktivitet i vald tidsperiod.
              </p>
            );
          }

          const formatLabel = (iso: string) =>
            hourly
              ? new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
              : new Date(iso).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' });

          const tooltipFor = (iso: string, count: number) =>
            `${formatLabel(iso)} – ${count} ärenden`;

          // Hourly view packs 24 bars in; only label every 3rd hour (plus the
          // last one) so the axis stays readable. Daily views label every bar.
          const showLabel = (index: number) =>
            !hourly || index % 3 === 0 || index === activity.length - 1;

          return (
            <div className="flex items-end justify-between h-64 gap-1 sm:gap-2">
              {activity.map((point, index) => {
                // Baseline of 2% so bars are still visible on zero-count
                // buckets (makes it clear the chart rendered, not just broke).
                const ratio = point.count / maxCount;
                const height = point.count === 0 ? 2 : Math.max(ratio * 100, 4);
                return (
                  <div key={index} className="flex-1 flex flex-col items-center min-w-0">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                      {point.count}
                    </span>
                    <div className="w-full flex items-end justify-center h-full">
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
