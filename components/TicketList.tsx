import { useState } from 'react';
import type { Ticket } from '@/lib/types';
import { statusLabelSv, agentColor } from '@/lib/constants';
import { t } from '@/lib/i18n';
import { Trash2, Pencil } from 'lucide-react';

type PresenceViewer = { name: string; email: string; initials: string; typing?: boolean };
type PresenceMap = Record<string, PresenceViewer[]>;

interface TicketListProps {
  tickets: Ticket[];
  selectedTicket: Ticket | null;
  onSelectTicket: (ticket: Ticket) => void;
  presence?: PresenceMap;
  onDelete?: (ticketId: string) => void;
  // Server-side pagination (used by the archived folder, where the client
  // only holds a page at a time): `totalCount` is the true total on the
  // server, `hasMore`/`onLoadMore` fetch the next page, `loadingMore` shows
  // the spinner state on the button while that fetch runs.
  totalCount?: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

// Cap how many rows we put in the DOM at once. Folders like "Alla" and
// "Stängda" can hold 2000+ tickets, and rendering every one as a rich row
// (with no virtualization) froze the tab. Older rows are still reachable:
// the "Visa fler äldre ärenden" button at the bottom raises the cap one page
// at a time (and pulls the next page from the server when the local list
// runs out), so nothing is permanently hidden.
const MAX_RENDERED_ROWS = 200;

export default function TicketList({ tickets, selectedTicket, onSelectTicket, presence = {}, onDelete, totalCount, hasMore = false, onLoadMore, loadingMore = false }: TicketListProps) {
  const [renderLimit, setRenderLimit] = useState(MAX_RENDERED_ROWS);
  const visibleTickets = tickets.length > renderLimit
    ? tickets.slice(0, renderLimit)
    : tickets;
  // True total for the header/footer: the server's count when paginated,
  // otherwise the in-memory list length.
  const trueTotal = Math.max(totalCount ?? 0, tickets.length);

  const handleShowMore = () => {
    const nextLimit = renderLimit + MAX_RENDERED_ROWS;
    setRenderLimit(nextLimit);
    // The local list is about to run out — pull the next page from the
    // server so the expanded view actually has older tickets to show.
    if (hasMore && onLoadMore && !loadingMore && tickets.length < nextLimit) {
      onLoadMore();
    }
  };
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new':
        return 'border border-blue-300 text-blue-800 dark:border-blue-700 dark:text-blue-200';
      case 'in_progress':
        return 'border border-yellow-300 text-yellow-800 dark:border-yellow-700 dark:text-yellow-200';
      case 'review':
        return 'border border-purple-300 text-purple-800 dark:border-purple-700 dark:text-purple-200';
      case 'sent':
        return 'border border-green-300 text-green-800 dark:border-green-700 dark:text-green-200';
      case 'closed':
        return 'border border-zinc-300 text-zinc-800 dark:border-zinc-600 dark:text-zinc-200';
      case 'archived':
        return 'border border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200';
      case 'duplicate':
        return 'border border-rose-300 text-rose-800 dark:border-rose-700 dark:text-rose-200';
      default:
        return 'border border-zinc-300 text-zinc-800 dark:border-zinc-600 dark:text-zinc-200';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'text-red-600 dark:text-red-400';
      case 'high':
        return 'text-orange-600 dark:text-orange-400';
      case 'normal':
        return 'text-zinc-600 dark:text-zinc-400';
      case 'low':
        return 'text-zinc-400 dark:text-zinc-500';
      default:
        return 'text-zinc-600 dark:text-zinc-400';
    }
  };

  // Left-edge color bar + chip color so prioritized tickets are
  // immediately scannable in the list. Red = urgent (akut), orange =
  // high (hög), yellow = normal-with-attention is not used (we keep
  // normal neutral so the warm colors stay meaningful).
  // Traffic-light ranking: red = high priority (urgent/high), yellow =
  // normal, green = low. The left-edge stripe makes each customer's rank
  // scannable at a glance.
  const getPriorityStripe = (priority: string): { stripe: string; chipBg: string; label: string } => {
    switch (priority) {
      case 'urgent':
        return { stripe: 'bg-red-500', chipBg: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700', label: t('Hög') };
      case 'high':
        return { stripe: 'bg-red-500', chipBg: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700', label: t('Hög') };
      case 'normal':
        return { stripe: 'bg-yellow-400', chipBg: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-700', label: t('Medel') };
      case 'low':
        return { stripe: 'bg-green-500', chipBg: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700', label: t('Låg') };
      default:
        return { stripe: 'bg-yellow-400', chipBg: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600', label: priority };
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('Ärenden')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{trueTotal} {t('totalt')}</p>
      </div>
      <div className="divide-y divide-slate-200 dark:divide-slate-700 max-h-[calc(100vh-12rem)] overflow-y-auto">
        {tickets.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            {t('Inga ärenden ännu')}
          </div>
        ) : (
          <>
          {visibleTickets.map((ticket) => {
            const prio = getPriorityStripe(ticket.priority);
            const handleRowClick = () => onSelectTicket(ticket);
            const handleRowKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectTicket(ticket);
              }
            };
            const handleTrashClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              if (!onDelete) return;
              if (confirm(t('Ta bort detta ärende? Detta kan inte ångras.'))) {
                onDelete(ticket.id);
              }
            };
            return (
            <div
              key={ticket.id}
              role="button"
              tabIndex={0}
              onClick={handleRowClick}
              onKeyDown={handleRowKey}
              className={`relative w-full text-left pl-5 p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${
                selectedTicket?.id === ticket.id ? 'bg-slate-50 dark:bg-slate-700' : ''
              }`}
            >
              {/* Priority color stripe on the left edge — at-a-glance
                  signal of how urgent each ticket is. */}
              <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${prio.stripe}`} aria-hidden="true" />
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                  {ticket.subject}
                </h3>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {presence[ticket.id]?.some((v) => v.typing) && (
                    <span
                      className="flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                      title={t('Någon skriver ett svar just nu')}
                    >
                      <Pencil className="w-3 h-3 animate-pulse" /> {t('skriver')}
                    </span>
                  )}
                  {presence[ticket.id] && presence[ticket.id].length > 0 && (
                    <div className="flex -space-x-1">
                      {presence[ticket.id].map((viewer, idx) => {
                        const color = agentColor(viewer.name || viewer.email);
                        return (
                          <div
                            key={idx}
                            title={`${viewer.name} (${viewer.email})`}
                            style={{ backgroundColor: color.bg, color: color.text }}
                            className="w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center border-2 border-white dark:border-slate-800"
                          >
                            {viewer.initials}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={handleTrashClick}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:text-slate-500 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                      title={t('Ta bort ärende')}
                      aria-label={t('Ta bort ärende')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <span>{ticket.customerEmail}</span>
                <span>•</span>
                {/* Two timestamps: when the original mail arrived (createdAt
                    holds the Gmail internalDate for synced tickets) and
                    when the ticket last had activity (updatedAt — bumps
                    on follow-up mails). Show "uppdaterad" only when
                    there's a real gap so the row stays clean for fresh
                    tickets. */}
                <span suppressHydrationWarning title={t('Inkommet')}>
                  {new Date(ticket.createdAt).toLocaleString('sv-SE')}
                </span>
                {(() => {
                  const created = new Date(ticket.createdAt).getTime();
                  const updated = new Date(ticket.updatedAt).getTime();
                  const gapMs = updated - created;
                  if (gapMs <= 60_000) return null;
                  return (
                    <>
                      <span>•</span>
                      <span
                        suppressHydrationWarning
                        title={t('Senaste aktivitet')}
                        className="text-amber-700 dark:text-amber-400 font-medium"
                      >
                        {t('Uppdaterad')} {new Date(ticket.updatedAt).toLocaleString('sv-SE')}
                      </span>
                    </>
                  );
                })()}
                {ticket.aiResponse && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-full font-medium">
                      ✨ AI
                      {ticket.aiConfidence && (
                        <span className="ml-1 text-[10px] opacity-90">
                          {Math.round(ticket.aiConfidence * 100)}%
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(ticket.status)}`}>
                  {statusLabelSv(ticket.status)}
                </span>
                {(ticket.priority === 'urgent' || ticket.priority === 'high') && (
                  <span className={`text-xs px-2 py-1 rounded-full font-semibold ${prio.chipBg}`}>
                    {prio.label}
                  </span>
                )}
                {ticket.assignedTo && (() => {
                  const color = agentColor(ticket.assignedTo);
                  return (
                    <span
                      className="text-xs px-2 py-1 rounded-full font-semibold"
                      style={{
                        backgroundColor: color.bg,
                        color: color.text,
                        border: `1px solid ${color.border}`,
                      }}
                    >
                      {ticket.assignedTo}
                    </span>
                  );
                })()}
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {new Date(ticket.createdAt).toLocaleDateString('sv-SE')}
                </span>
              </div>
            </div>
            );
          })}
          {(tickets.length > visibleTickets.length || hasMore) && (
            <div className="p-4 text-center">
              <button
                type="button"
                onClick={handleShowMore}
                disabled={loadingMore}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? t('Laddar fler…') : t('Visa fler äldre ärenden')}
              </button>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t('Visar')} {visibleTickets.length} / {trueTotal} {t('ärenden')}
              </div>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}
