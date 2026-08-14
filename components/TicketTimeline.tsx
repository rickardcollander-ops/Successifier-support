'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, History, Mail, Send, UserPlus, Play, ArrowRightLeft, CirclePlus, BellRing } from 'lucide-react';
import { t } from '@/lib/i18n';
import { statusLabelSv } from '@/lib/constants';

// Collapsible "Historik" section for the ticket detail view: the ticket's
// full activity timeline from the TicketEvent log (created, inbound mail,
// status changes, assignments, replies with response time, work started).
// The log has powered the reports for a while — this makes it visible on
// the ticket itself. Lazy: events are fetched the first time the section
// is expanded, per ticket.

interface TimelineEvent {
  id: string;
  type: string;
  actor: string | null;
  fromValue: string | null;
  toValue: string | null;
  responseSeconds: number | null;
  createdAt: string;
}

// Compact "3 min" / "2,5 h" / "1,2 dygn" for reply response times.
function fmtDuration(seconds: number): string {
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 48 * 3600) return `${Math.round((seconds / 3600) * 10) / 10} h`;
  return `${Math.round((seconds / 86400) * 10) / 10} ${t('dygn')}`;
}

function eventLine(e: TimelineEvent): { icon: typeof Mail; label: string; detail?: string } {
  switch (e.type) {
    case 'created':
      return { icon: CirclePlus, label: t('Ärendet skapades') };
    case 'inbound_received':
      return { icon: Mail, label: t('Nytt meddelande från kunden') };
    case 'status_changed':
      return {
        icon: ArrowRightLeft,
        label: t('Status ändrades'),
        detail: `${statusLabelSv(e.fromValue || '')} → ${statusLabelSv(e.toValue || '')}`,
      };
    case 'assigned':
      return {
        icon: UserPlus,
        label: e.toValue ? `${t('Tilldelades')} ${e.toValue}` : t('Tilldelning togs bort'),
      };
    case 'reply_sent':
      return {
        icon: Send,
        label: t('Svar skickades'),
        detail: e.responseSeconds != null ? `${t('svarstid')} ${fmtDuration(e.responseSeconds)}` : undefined,
      };
    case 'work_started':
      return { icon: Play, label: t('Arbete påbörjades') };
    case 'sla_alert':
      return { icon: BellRing, label: t('SLA-larm skickades') };
    default:
      return { icon: History, label: e.type };
  }
}

export default function TicketTimeline({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  // New ticket → old timeline is stale; refetch on next expand.
  useEffect(() => {
    setEvents(null);
    setOpen(false);
  }, [ticketId]);

  useEffect(() => {
    if (!open || events !== null) return;
    let cancelled = false;
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/tickets/${ticketId}/events`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setEvents(data.events || []);
        } else if (!cancelled) {
          setEvents([]);
        }
      } catch (error) {
        console.error('Error fetching ticket timeline:', error);
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchEvents();
    return () => { cancelled = true; };
  }, [open, events, ticketId]);

  return (
    <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400" />
        )}
        <History className="w-4 h-4 text-[#7C5CFF]" />
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('Historik')}</h3>
      </button>

      {open && (
        <div className="mt-3">
          {loading && (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('Laddar historik...')}</p>
          )}
          {!loading && events && events.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('Ingen loggad historik för det här ärendet.')}
            </p>
          )}
          {!loading && events && events.length > 0 && (
            <ol className="space-y-2">
              {events.map((e) => {
                const { icon: Icon, label, detail } = eventLine(e);
                return (
                  <li key={e.id} className="flex items-start gap-2.5 text-xs">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                    </span>
                    <span className="flex-1 min-w-0 text-slate-700 dark:text-slate-300">
                      <span className="font-medium">{label}</span>
                      {detail && <span className="text-slate-500 dark:text-slate-400"> · {detail}</span>}
                      {e.actor && e.type !== 'assigned' && (
                        <span className="text-slate-400 dark:text-slate-500"> · {e.actor}</span>
                      )}
                    </span>
                    <span
                      className="flex-shrink-0 text-slate-400 dark:text-slate-500"
                      title={new Date(e.createdAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}
                    >
                      {new Date(e.createdAt).toLocaleString('sv-SE', {
                        timeZone: 'Europe/Stockholm',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
