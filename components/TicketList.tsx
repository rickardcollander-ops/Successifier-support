import type { Ticket } from '@/lib/types';

interface TicketListProps {
  tickets: Ticket[];
  selectedTicket: Ticket | null;
  onSelectTicket: (ticket: Ticket) => void;
}

export default function TicketList({ tickets, selectedTicket, onSelectTicket }: TicketListProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'review':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'sent':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'closed':
        return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200';
      case 'archived':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
      default:
        return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200';
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
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Tickets</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tickets.length} total</p>
      </div>
      <div className="divide-y divide-slate-200 dark:divide-slate-700 max-h-[calc(100vh-12rem)] overflow-y-auto">
        {tickets.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            No tickets yet
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
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <span>{ticket.customerEmail}</span>
                {ticket.customerNumber && (
                  <>
                    <span>•</span>
                    <span>#{ticket.customerNumber}</span>
                  </>
                )}
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
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(ticket.status)}`}>
                  {ticket.status.replace('_', ' ')}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {new Date(ticket.createdAt).toLocaleDateString()}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
