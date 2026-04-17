import type { Ticket } from '@/lib/types';
import { statusLabelSv, agentColor } from '@/lib/constants';

type PresenceViewer = { name: string; email: string; initials: string };
type PresenceMap = Record<string, PresenceViewer[]>;

interface TicketListProps {
  tickets: Ticket[];
  selectedTicket: Ticket | null;
  onSelectTicket: (ticket: Ticket) => void;
  presence?: PresenceMap;
}

export default function TicketList({ tickets, selectedTicket, onSelectTicket, presence = {} }: TicketListProps) {
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

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Ärenden</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tickets.length} totalt</p>
      </div>
      <div className="divide-y divide-slate-200 dark:divide-slate-700 max-h-[calc(100vh-12rem)] overflow-y-auto">
        {tickets.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            Inga ärenden ännu
          </div>
        ) : (
          tickets.map((ticket) => (
            <button
              key={ticket.id}
              onClick={() => onSelectTicket(ticket)}
              className={`w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${
                selectedTicket?.id === ticket.id ? 'bg-slate-50 dark:bg-slate-700' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                  {ticket.subject}
                </h3>
                {presence[ticket.id] && presence[ticket.id].length > 0 && (
                  <div className="flex -space-x-1 flex-shrink-0">
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
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <span>{ticket.customerEmail}</span>
                <span>•</span>
                <span suppressHydrationWarning>{new Date(ticket.createdAt).toLocaleString()}</span>
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
            </button>
          ))
        )}
      </div>
    </div>
  );
}
