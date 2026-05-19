'use client';

import { useState, useEffect, useRef } from 'react';
import TicketList from '@/components/TicketList';
import TicketDetail from '@/components/TicketDetail';
import type { Ticket } from '@/lib/types';

interface EmailSyncStatus {
  lastSyncAt: Date | null;
  totalNewTickets: number;
  syncedAccounts: number;
  error: string | null;
}

type PresenceViewer = { name: string; email: string; initials: string };
type PresenceMap = Record<string, PresenceViewer[]>;

export default function TicketsPage() {
  // Deep-link param: `/tickets?ticket=<id>` lands here from the Settings
  // "Drabbade kunder" table so support can jump straight to a ticket.
  // We read it from window.location instead of useSearchParams so the
  // page doesn't need to be wrapped in <Suspense> for Next.js 15
  // prerendering — `/tickets` is rendered dynamically anyway.
  const [deepLinkTicketId, setDeepLinkTicketId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('ticket');
    if (id) setDeepLinkTicketId(id);
  }, []);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [archivedTickets, setArchivedTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [activeStatus, setActiveStatus] = useState<string>('all');
  const [archivedSearch, setArchivedSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // Default to "senaste aktivitet" so any ticket that just got a new
  // follow-up email bubbles to the top — same semantics as a normal
  // inbox. The old "date" sort by createdAt left replies buried at the
  // bottom because the original ticket's createdAt didn't move.
  const [sortBy, setSortBy] = useState<'activity' | 'received' | 'priority' | 'status' | 'email'>('activity');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [ticketPresence, setTicketPresence] = useState<PresenceMap>({});
  const [emailSyncStatus, setEmailSyncStatus] = useState<EmailSyncStatus>({
    lastSyncAt: null,
    totalNewTickets: 0,
    syncedAccounts: 0,
    error: null,
  });
  const [dedupeRunning, setDedupeRunning] = useState(false);
  const [dedupeResult, setDedupeResult] = useState<string | null>(null);
  const [emptyingFolder, setEmptyingFolder] = useState(false);
  const [reopeningAffected, setReopeningAffected] = useState(false);
  const [reopenResult, setReopenResult] = useState<string | null>(null);

  const reopenAffectedTickets = async () => {
    if (reopeningAffected) return;
    if (!confirm('Återöppna alla ärenden där en kund svarade efter att ärendet markerats som löst/skickat? De flyttas tillbaka till Öppna så ni kan följa upp.')) return;
    setReopeningAffected(true);
    setReopenResult(null);
    try {
      const res = await fetch('/api/admin/reopen-affected', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setReopenResult(`Fel: ${err.error || res.status}`);
        return;
      }
      const data = await res.json();
      setReopenResult(`Återöppnade ${data.reopened} ärenden — finns nu i Öppna.`);
      await fetchTickets();
    } catch (error) {
      setReopenResult('Nätverksfel vid återöppning');
    } finally {
      setReopeningAffected(false);
    }
  };

  const emptyCurrentFolder = async () => {
    if (emptyingFolder) return;
    const folderLabels: Record<string, string> = {
      billecta: 'Billecta',
      duplicate: 'Dubletter',
      bounce: 'Studsade',
    };
    const label = folderLabels[activeStatus];
    if (!label) return;
    if (!confirm(`Är du säker på att du vill tömma hela ${label}-inkorgen? Alla ärenden i mappen kommer att raderas permanent och detta kan inte ångras.`)) return;
    setEmptyingFolder(true);
    try {
      const res = await fetch('/api/tickets/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: activeStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Fel vid tömning: ${err.error || res.status}`);
        return;
      }
      if (selectedTicket) setSelectedTicket(null);
      await fetchTickets();
    } catch (error) {
      alert('Nätverksfel vid tömning av mapp');
    } finally {
      setEmptyingFolder(false);
    }
  };

  const runDedupeExisting = async () => {
    if (dedupeRunning) return;
    if (!confirm('Scanna igenom alla ärenden och flytta dubletter (samma avsändare + ämne inom 10 min) till fliken Dubletter?')) return;
    setDedupeRunning(true);
    setDedupeResult(null);
    try {
      const res = await fetch('/api/admin/dedupe-existing', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDedupeResult(`Fel: ${err.error || res.status}`);
        return;
      }
      const data = await res.json();
      setDedupeResult(`Flyttade ${data.markedAsDuplicate} ärenden i ${data.groups} grupper till Dubletter.`);
      await fetchTickets();
    } catch (error) {
      setDedupeResult('Nätverksfel vid rensning');
    } finally {
      setDedupeRunning(false);
    }
  };

  const triggerEmailSync = async () => {
    try {
      const response = await fetch('/api/email-accounts/sync-all', { method: 'POST' });

      if (!response.ok) {
        setEmailSyncStatus((prev) => ({
          ...prev,
          lastSyncAt: new Date(),
          error: `Email sync failed (HTTP ${response.status})`,
        }));
        return;
      }

      const data = await response.json();
      setEmailSyncStatus({
        lastSyncAt: new Date(),
        totalNewTickets: Number(data?.totalNewTickets || 0),
        syncedAccounts: Number(data?.syncedAccounts || 0),
        error: null,
      });
    } catch (error) {
      console.error('Error syncing email accounts:', error);
      setEmailSyncStatus((prev) => ({
        ...prev,
        lastSyncAt: new Date(),
        error: 'Email sync failed',
      }));
    }
  };

  // Report presence and fetch other viewers
  const reportPresence = async (ticketId: string | null) => {
    try {
      await fetch('/api/tickets/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });
    } catch {}
  };

  const fetchPresence = async () => {
    try {
      const res = await fetch('/api/tickets/presence');
      if (res.ok) {
        const data = await res.json();
        setTicketPresence(data.viewers || {});
      }
    } catch {}
  };

  // Track the currently-selected ticket in a ref so the heartbeat interval
  // (which is set up once on mount) always reads the latest value instead
  // of a stale closure capture. Without this, presence stops updating after
  // the ticket the user opened first is replaced — which caused Ida to
  // disappear from Malin's view and vice versa.
  const selectedTicketIdRef = useRef<string | null>(null);

  // Tombstones for tickets the user just deleted. A poll request that
  // started before the DELETE landed will still see the ticket and, if
  // we don't filter it out, the merge would resurrect it for the next
  // 3 seconds — making "Radera"/"Markera som löst" feel broken.
  const recentlyDeletedRef = useRef<Map<string, number>>(new Map());
  const TOMBSTONE_TTL_MS = 30_000;

  // Report presence when selected ticket changes
  useEffect(() => {
    selectedTicketIdRef.current = selectedTicket?.id || null;
    reportPresence(selectedTicket?.id || null);
  }, [selectedTicket?.id]);

  // Honour the ?ticket=<id> deep link from Settings → Drabbade kunder.
  // Fetch the ticket directly (it may not be in the active list if it's
  // closed/sent) and select it, then strip the param from the URL so a
  // refresh doesn't keep re-selecting the same one.
  useEffect(() => {
    if (!deepLinkTicketId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tickets/${deepLinkTicketId}`);
        if (!res.ok || cancelled) return;
        const ticket = await res.json();
        if (!cancelled && ticket?.id) {
          setSelectedTicket(ticket);
          if (ticket.status === 'closed') setActiveStatus('closed');
          else if (ticket.status === 'sent') setActiveStatus('sent');
          else setActiveStatus('all');
        }
      } catch {
        // ignore — leaves selection unchanged
      } finally {
        if (!cancelled && typeof window !== 'undefined') {
          window.history.replaceState({}, '', '/tickets');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deepLinkTicketId]);

  useEffect(() => {
    fetchTickets();
    triggerEmailSync();
    fetchPresence();

    // Poll for updates every 3 seconds to catch AI responses being generated
    const interval = setInterval(() => {
      fetchTickets();
      fetchPresence();
    }, 3000);

    // Pull unread emails from all connected Gmail accounts periodically
    const emailSyncInterval = setInterval(() => {
      triggerEmailSync();
    }, 60000);

    // Presence heartbeat — read from the ref so we always report the
    // currently-selected ticket, not the one selected at mount time.
    const presenceInterval = setInterval(() => {
      const id = selectedTicketIdRef.current;
      if (id) reportPresence(id);
    }, 5000);

    return () => {
      clearInterval(interval);
      clearInterval(emailSyncInterval);
      clearInterval(presenceInterval);
      reportPresence(null); // clear presence on unmount
    };
  }, []);

  const fetchTickets = async () => {
    try {
      const response = await fetch('/api/tickets');
      if (response.ok) {
        const data = await response.json();
        let incoming: Ticket[] = data.tickets || [];

        // Drop tombstoned tickets — anything we deleted in the last
        // ~30s. Without this, an in-flight poll from before the DELETE
        // would resurrect the row for the next cycle. Also drop
        // expired tombstones so the map doesn't grow forever.
        const now = Date.now();
        for (const [id, ts] of recentlyDeletedRef.current.entries()) {
          if (now - ts > TOMBSTONE_TTL_MS) {
            recentlyDeletedRef.current.delete(id);
          }
        }
        if (recentlyDeletedRef.current.size > 0) {
          incoming = incoming.filter((t) => !recentlyDeletedRef.current.has(t.id));
        }

        // Merge against the live state instead of replacing wholesale.
        // The 3-second poll otherwise raced with PATCH: a poll request
        // that started before the user closed/marked-as-resolved a
        // ticket would return the stale version a moment later and
        // revert the local update — making the ticket "stay" in its
        // old folder. We keep whichever copy has the newer updatedAt.
        setTickets((prev) => {
          const incomingMap = new Map(incoming.map((t) => [t.id, t]));
          const merged: Ticket[] = [];
          const seen = new Set<string>();

          for (const local of prev) {
            const fresh = incomingMap.get(local.id);
            if (!fresh) {
              // Not in server response. If our local copy is very
              // recent (likely an in-flight create) keep it; otherwise
              // it's gone (deleted elsewhere) so drop it.
              const localTs = new Date(local.updatedAt).getTime();
              if (Date.now() - localTs < 30_000) {
                merged.push(local);
                seen.add(local.id);
              }
              continue;
            }
            const localTs = new Date(local.updatedAt).getTime();
            const freshTs = new Date(fresh.updatedAt).getTime();
            merged.push(freshTs >= localTs ? fresh : local);
            seen.add(local.id);
          }

          for (const fresh of incoming) {
            if (!seen.has(fresh.id)) merged.push(fresh);
          }
          return merged;
        });

        // Refresh the selected ticket only when the server has a newer
        // copy than what we're showing — same reasoning as above so the
        // detail pane doesn't snap back to a pre-close state.
        if (selectedTicket) {
          const updatedSelected = incoming.find((t: Ticket) => t.id === selectedTicket.id);
          if (updatedSelected) {
            const localTs = new Date(selectedTicket.updatedAt).getTime();
            const freshTs = new Date(updatedSelected.updatedAt).getTime();
            if (freshTs >= localTs) {
              setSelectedTicket(updatedSelected);
            }
          }
        }
      } else {
        // Use mock data if API fails
        setTickets([
          {
            id: 'mock-1',
            tenantId: 'doldadress',
            customerEmail: 'customer@example.com',
            customerName: 'Test Customer',
            subject: 'Test ticket with integration data',
            status: 'new',
            priority: 'normal',
            originalMessage: 'This is a test ticket to demonstrate integration info cards.',
            createdAt: new Date(),
            updatedAt: new Date(),
            contextData: {
              stripe: {
                customerId: 'cus_test123',
                subscriptions: [{ id: 'sub_1' }, { id: 'sub_2' }],
                invoices: [{ id: 'inv_1' }, { id: 'inv_2' }, { id: 'inv_3' }],
                charges: [{ id: 'ch_1' }, { id: 'ch_2' }],
              },
              billecta: {
                debtorId: 'debtor_123',
                invoices: [{ id: 'bill_1' }, { id: 'bill_2' }],
              },
              resend: {
                emailsSent: 15,
                recentEmails: [{ id: 'email_1' }, { id: 'email_2' }, { id: 'email_3' }],
              },
              retool: {
                customData: 'Available',
              },
            },
          },
        ] as any);
      }
    } catch (error) {
      console.error('Error fetching tickets:', error);
      // Use mock data on error
      setTickets([
        {
          id: 'mock-1',
          tenantId: 'doldadress',
          customerEmail: 'customer@example.com',
          customerName: 'Test Customer',
          subject: 'Test ticket with integration data',
          status: 'new',
          priority: 'normal',
          originalMessage: 'This is a test ticket to demonstrate integration info cards.',
          createdAt: new Date(),
          updatedAt: new Date(),
          contextData: {
            stripe: {
              customerId: 'cus_test123',
              subscriptions: [{ id: 'sub_1' }, { id: 'sub_2' }],
              invoices: [{ id: 'inv_1' }, { id: 'inv_2' }, { id: 'inv_3' }],
              charges: [{ id: 'ch_1' }, { id: 'ch_2' }],
            },
            billecta: {
              debtorId: 'debtor_123',
              invoices: [{ id: 'bill_1' }, { id: 'bill_2' }],
            },
            resend: {
              emailsSent: 15,
              recentEmails: [{ id: 'email_1' }, { id: 'email_2' }, { id: 'email_3' }],
            },
            gmail: {
              totalEmails: 42,
              recentEmails: [{ id: 'thread_1' }, { id: 'thread_2' }, { id: 'thread_3' }, { id: 'thread_4' }],
            },
            retool: {
              customData: 'Available',
            },
          },
        },
      ] as any);
    } finally {
      setLoading(false);
    }
  };

  const handleTicketUpdate = async (ticketId: string, updates: Partial<Ticket>) => {
    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        const updatedTicket = await response.json();
        // Functional setState so concurrent polls/updates don't clobber
        // the local update (e.g. a stale poll arriving after this PATCH).
        setTickets((prev) => prev.map(t => t.id === ticketId ? updatedTicket : t));
        // When closing a ticket the detail view already calls
        // onSelectTicket(null) to clear the selection. Don't restore the
        // updated ticket here — that race was the "stäng-ärende-bugg"
        // where pressing Löst briefly cleared the selection and then the
        // PATCH response set it right back.
        if ((updates as any).status === 'closed') {
          setSelectedTicket((curr) => (curr?.id === ticketId ? null : curr));
        } else if (selectedTicket?.id === ticketId) {
          setSelectedTicket(updatedTicket);
        }
      }
    } catch (error) {
      console.error('Error updating ticket:', error);
    }
  };

  const handleGenerateAIResponse = async (ticketId: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/tickets/${ticketId}/generate-response`, {
        method: 'POST',
      });

      if (response.ok) {
        const updatedTicket = await response.json();
        setTickets((prev) => prev.map(t => t.id === ticketId ? updatedTicket : t));
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket(updatedTicket);
        }
        return updatedTicket.aiResponse || null;
      }
      return null;
    } catch (error) {
      console.error('Error generating AI response:', error);
      return null;
    }
  };

  const handleSendResponse = async (ticketId: string, response: string, fromAccountId?: string, recipientEmail?: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, fromAccountId, recipientEmail }),
      });

      if (res.ok) {
        const updatedTicket = await res.json();
        setTickets((prev) => prev.map(t => t.id === ticketId ? updatedTicket : t));
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket(updatedTicket);
        }
        return { ok: true };
      }
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    } catch (error: any) {
      console.error('Error sending response:', error);
      return { ok: false, error: error?.message || 'Nätverksfel' };
    }
  };

  const handleDeleteTicket = async (ticketId: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/delete`, {
        method: 'DELETE',
      });

      if (res.ok) {
        recentlyDeletedRef.current.set(ticketId, Date.now());
        setTickets((prev) => prev.filter(t => t.id !== ticketId));
        setArchivedTickets((prev) => prev.filter(t => t.id !== ticketId));
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket(null);
        }
      }
    } catch (error) {
      console.error('Error deleting ticket:', error);
    }
  };

  const handleSpamTicket = async (ticketId: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/spam`, {
        method: 'POST',
      });

      if (res.ok) {
        const updatedTicket = await res.json();
        setTickets((prev) => prev.map(t => t.id === ticketId ? updatedTicket : t));
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket(updatedTicket);
        }
      }
    } catch (error) {
      console.error('Error marking ticket as spam:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Laddar ärenden…</div>
      </div>
    );
  }

  const fetchArchivedTickets = async () => {
    if (archivedTickets.length > 0) return;
    setLoadingArchived(true);
    try {
      const response = await fetch('/api/tickets?status=archived');
      if (response.ok) {
        const data = await response.json();
        setArchivedTickets(data.tickets);
      }
    } catch (error) {
      console.error('Error fetching archived tickets:', error);
    } finally {
      setLoadingArchived(false);
    }
  };

  const billectaTickets = tickets.filter(t => t.customerEmail.toLowerCase() === 'no-reply@billecta.com');

  // Bounces (mailer-daemon, postmaster, delivery-status-notification…)
  // get their own folder so they don't clutter the inbox. Match on
  // sender prefix AND on the standard subject lines that bounce
  // notifications use, since some bounces come from neutrally-named
  // addresses but always have a recognizable subject.
  const isBounceTicket = (t: Ticket) => {
    const email = t.customerEmail.toLowerCase();
    if (
      email.startsWith('mailer-daemon@') ||
      email.startsWith('postmaster@') ||
      email.startsWith('mailer-noreply@') ||
      email.includes('mail-daemon@')
    ) return true;
    const subj = t.subject.toLowerCase();
    return (
      subj.includes('delivery status notification') ||
      subj.includes('undeliverable') ||
      subj.includes('mail delivery failed') ||
      subj.includes('returned mail') ||
      subj.startsWith('failure notice')
    );
  };
  const bounceTickets = tickets.filter(isBounceTicket);

  // Filter by status. Billecta and Kivra-notifications from Billecta used to
  // live in two separate tabs; they're now merged into a single "Billecta"
  // folder per user request. Bounces are excluded from every "normal" tab
  // and only appear under the "Studsade" tab.
  let statusFilteredTickets = activeStatus === 'all'
    ? tickets.filter(t => t.customerEmail.toLowerCase() !== 'no-reply@billecta.com' && t.status !== 'duplicate' && !isBounceTicket(t))
    : activeStatus === 'billecta'
    ? billectaTickets
    : activeStatus === 'duplicate'
    ? tickets.filter(t => t.status === 'duplicate')
    : activeStatus === 'bounce'
    ? bounceTickets
    : tickets.filter(t => t.status === activeStatus && t.customerEmail.toLowerCase() !== 'no-reply@billecta.com' && !isBounceTicket(t));

  // Apply search filter
  const searchFilteredTickets = searchQuery
    ? statusFilteredTickets.filter(t => 
        t.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.customerEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.customerName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.originalMessage.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : statusFilteredTickets;

  // Apply sorting
  const filteredTickets = [...searchFilteredTickets].sort((a, b) => {
    let comparison = 0;
    
    if (sortBy === 'activity') {
      // Senaste aktivitet — updatedAt bumps when a follow-up mail is
      // merged in, so tickets needing attention rise to the top.
      comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    } else if (sortBy === 'received') {
      // Mail-ankomsttid — sync routes write Gmail's internalDate into
      // createdAt, so this reflects when the customer actually sent it.
      comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    } else if (sortBy === 'priority') {
      const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
      comparison = (priorityOrder[a.priority] || 999) - (priorityOrder[b.priority] || 999);
    } else if (sortBy === 'status') {
      const statusOrder: Record<string, number> = { new: 0, in_progress: 1, waiting_ai: 1, review: 2, sent: 3, closed: 4, archived: 5 };
      comparison = (statusOrder[a.status] || 999) - (statusOrder[b.status] || 999);
    } else if (sortBy === 'email') {
      const emailCmp = a.customerEmail.toLowerCase().localeCompare(b.customerEmail.toLowerCase());
      comparison = emailCmp !== 0
        ? emailCmp
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const filteredArchivedTickets = archivedTickets.filter(t => {
    if (!archivedSearch) return true;
    const search = archivedSearch.toLowerCase();
    return (
      t.subject.toLowerCase().includes(search) ||
      t.customerEmail.toLowerCase().includes(search) ||
      (t.customerName || '').toLowerCase().includes(search)
    );
  });

  // Excludes Billecta, bounces and dubletter from "normal" counters so
  // the status tabs stay focused on real customer mail.
  const isExcludedFromNormal = (t: Ticket) =>
    t.customerEmail.toLowerCase() === 'no-reply@billecta.com' || isBounceTicket(t);

  const statusCounts = {
    all: tickets.filter(t => !isExcludedFromNormal(t) && t.status !== 'duplicate').length,
    billecta: billectaTickets.length,
    bounce: bounceTickets.length,
    new: tickets.filter(t => t.status === 'new' && !isExcludedFromNormal(t)).length,
    in_progress: tickets.filter(t => t.status === 'in_progress' && !isExcludedFromNormal(t)).length,
    review: tickets.filter(t => t.status === 'review' && !isExcludedFromNormal(t)).length,
    sent: tickets.filter(t => t.status === 'sent' && !isExcludedFromNormal(t)).length,
    closed: tickets.filter(t => t.status === 'closed' && !isExcludedFromNormal(t)).length,
    duplicate: tickets.filter(t => t.status === 'duplicate').length,
  };

  const tabs = [
    { id: 'new', label: 'Nya', count: statusCounts.new },
    { id: 'in_progress', label: 'Öppna', count: statusCounts.in_progress },
    { id: 'review', label: 'Granskning', count: statusCounts.review },
    { id: 'sent', label: 'Skickade', count: statusCounts.sent },
    { id: 'closed', label: 'Stängda', count: statusCounts.closed },
    { id: 'all', label: 'Alla', count: statusCounts.all },
    { id: 'billecta', label: 'Billecta', count: statusCounts.billecta },
    { id: 'bounce', label: 'Studsade', count: statusCounts.bounce },
    { id: 'duplicate', label: 'Dubletter', count: statusCounts.duplicate },
    { id: 'archived', label: 'Arkiverade', count: archivedTickets.length || '...' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Search and Sort Controls */}
      <div className="mb-3 flex items-center gap-3">
        <input
          type="text"
          placeholder="Sök ärenden (ämne, email, namn, meddelande)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-4 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'activity' | 'received' | 'priority' | 'status' | 'email')}
          className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
        >
          <option value="activity">Sortera: Senaste aktivitet</option>
          <option value="received">Sortera: Inkommet</option>
          <option value="priority">Sortera: Prioritet</option>
          <option value="status">Sortera: Status</option>
          <option value="email">Sortera: E-post</option>
        </select>
        <button
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          title={sortOrder === 'asc' ? 'Stigande' : 'Fallande'}
        >
          {sortOrder === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Tab Navigation & Email Sync Status */}
      <div className="mb-3 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex gap-1 overflow-x-auto flex-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveStatus(tab.id);
                if (tab.id === 'archived') fetchArchivedTickets();
              }}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-all ${
                activeStatus === tab.id
                  ? 'text-[#7C5CFF] border-b-2 border-[#7C5CFF] bg-[#7C5CFF]/5'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                activeStatus === tab.id
                  ? 'bg-[#7C5CFF] text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
          </div>
          {/* Dedupe button + Email Sync Status */}
          <div className="flex items-center gap-2">
            {(activeStatus === 'billecta' || activeStatus === 'duplicate' || activeStatus === 'bounce') && (() => {
              const folderName = activeStatus === 'billecta' ? 'Billecta'
                : activeStatus === 'duplicate' ? 'Dubletter'
                : 'Studsade';
              return (
                <button
                  onClick={emptyCurrentFolder}
                  disabled={emptyingFolder || filteredTickets.length === 0}
                  className="text-xs px-3 py-1.5 rounded-md border border-red-300 dark:border-red-700 bg-white dark:bg-slate-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 whitespace-nowrap"
                  title={`Radera alla ärenden i ${folderName}-mappen`}
                >
                  {emptyingFolder ? 'Tömmer…' : `Töm ${folderName}`}
                </button>
              );
            })()}
            <button
              onClick={runDedupeExisting}
              disabled={dedupeRunning}
              className="text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap"
              title="Scanna befintliga ärenden och flytta dubletter till fliken Dubletter"
            >
              {dedupeRunning ? 'Rensar…' : 'Rensa dubletter'}
            </button>
            <button
              onClick={reopenAffectedTickets}
              disabled={reopeningAffected}
              className="text-xs px-3 py-1.5 rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 disabled:opacity-50 whitespace-nowrap"
              title="Hitta ärenden där kunden svarade efter att supporten markerat som klart, och flytta tillbaka dem till Öppna"
            >
              {reopeningAffected ? 'Återöppnar…' : 'Återöppna drabbade'}
            </button>
            {(dedupeResult || reopenResult) && (
              <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {reopenResult || dedupeResult}
              </span>
            )}
            <div className={`text-xs px-3 py-1.5 rounded-md border whitespace-nowrap ${
              emailSyncStatus.error
                ? 'bg-white border-red-200 text-red-700 dark:bg-slate-800 dark:border-red-800 dark:text-red-300'
                : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
            }`}>
              {emailSyncStatus.error ? (
                <span>{emailSyncStatus.error}</span>
              ) : (
                <span>
                  Synk: {emailSyncStatus.lastSyncAt ? emailSyncStatus.lastSyncAt.toLocaleTimeString('sv-SE') : 'inte körd'}
                  {' '}• {emailSyncStatus.totalNewTickets} nya
                  {' '}• {emailSyncStatus.syncedAccounts} konton
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {activeStatus === 'archived' ? (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="mb-4">
            <input
              type="text"
              placeholder="Sök i arkiverade ärenden (ämne, e-post, namn)..."
              value={archivedSearch}
              onChange={(e) => setArchivedSearch(e.target.value)}
              className="w-full px-4 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]/50"
            />
          </div>
          {loadingArchived ? (
            <div className="flex items-center justify-center h-32">
              <div className="text-slate-500 dark:text-slate-400">Laddar arkiverade ärenden...</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden">
              <div className="lg:col-span-1 overflow-auto">
                <TicketList
                  tickets={filteredArchivedTickets}
                  selectedTicket={selectedTicket}
                  onSelectTicket={setSelectedTicket}
                  onDelete={handleDeleteTicket}
                />
              </div>
              <div className="lg:col-span-2 overflow-auto">
                {selectedTicket ? (
                  <TicketDetail
                    ticket={selectedTicket}
                    onUpdate={handleTicketUpdate}
                    onGenerateAI={handleGenerateAIResponse}
                    onSend={handleSendResponse}
                    onDelete={handleDeleteTicket}
                    onSpam={handleSpamTicket}
                    onSelectTicket={setSelectedTicket}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                    Välj ett arkiverat ärende för att visa detaljer
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden">
          <div className="lg:col-span-1 overflow-auto">
            <TicketList
              tickets={filteredTickets}
              selectedTicket={selectedTicket}
              onSelectTicket={setSelectedTicket}
              presence={ticketPresence}
              onDelete={handleDeleteTicket}
            />
          </div>
          <div className="lg:col-span-2 overflow-auto">
            {selectedTicket ? (
              <TicketDetail
                ticket={selectedTicket}
                onUpdate={handleTicketUpdate}
                onGenerateAI={handleGenerateAIResponse}
                onSend={handleSendResponse}
                onDelete={handleDeleteTicket}
                onSpam={handleSpamTicket}
                onSelectTicket={setSelectedTicket}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                Välj ett ärende för att visa detaljer
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
