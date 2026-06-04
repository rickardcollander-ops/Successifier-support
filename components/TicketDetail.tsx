'use client';

import { useState, useEffect, useRef } from 'react';
import { Mail, ChevronDown, Search, X, Loader2, Trash2, AlertOctagon, UserCircle2, CheckCircle2, Download, FileText, Pencil } from 'lucide-react';
import type { Ticket } from '@/lib/types';
import { htmlToText, isHtml } from '@/lib/utils/html-to-text';
import { AGENTS, statusLabelSv, agentColor } from '@/lib/constants';

// Three-level "traffic light" priority used to rank customers at a glance.
// We keep the existing four DB values working but expose only the three
// colours support asked for. 'high' is treated the same as 'urgent' (red).
type TrafficLight = { value: 'urgent' | 'normal' | 'low'; label: string; dot: string; ring: string };
const PRIORITY_LIGHTS: TrafficLight[] = [
  { value: 'urgent', label: 'Hög', dot: 'bg-red-500', ring: 'ring-red-500' },
  { value: 'normal', label: 'Medel', dot: 'bg-yellow-400', ring: 'ring-yellow-400' },
  { value: 'low', label: 'Låg', dot: 'bg-green-500', ring: 'ring-green-500' },
];
function priorityToLight(priority: string): 'urgent' | 'normal' | 'low' {
  if (priority === 'urgent' || priority === 'high') return 'urgent';
  if (priority === 'low') return 'low';
  return 'normal';
}

type DetailViewer = { name: string; email: string; initials: string; typing?: boolean };

interface ReplyFromAccount {
  id: string;
  email: string;
  provider: string;
  isActive: boolean;
}

interface CustomerHistoryResponse {
  customer: {
    email: string;
    name: string | null;
    totalTickets: number;
    openTickets: number;
    lastTicketAt: string | null;
  };
  billecta?: {
    source: 'context' | 'history';
    invoices: number;
    unpaidInvoices: number | null;
    relatedTickets: number;
    creditorPublicId?: string | null;
    debtorPublicId?: string | null;
    invoicesPreview?: Array<{
      id?: string;
      number?: string;
      status?: string;
      amount?: number | string;
      dueDate?: string;
      isPaid?: boolean;
    }>;
  } | null;
  previousTickets: Array<{
    id: string;
    subject: string;
    status: string;
    priority: string;
    createdAt: string;
  }>;
  similarIssues: Array<{
    id: string;
    subject: string;
    status: string;
    priority: string;
    createdAt: string;
    similarityScore: number;
    snippet: string;
  }>;
}

interface TicketDetailProps {
  ticket: Ticket;
  onUpdate: (ticketId: string, updates: Partial<Ticket>) => void;
  onGenerateAI: (ticketId: string) => Promise<string | null>;
  onSend: (ticketId: string, response: string, fromAccountId?: string, recipientEmail?: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete?: (ticketId: string) => void;
  onSpam?: (ticketId: string) => void;
  onSelectTicket?: (ticket: Ticket | null) => void;
  // Other agents currently on this ticket (for the "skrivläge" indicator).
  viewers?: DetailViewer[];
  // Report whether the current agent is actively composing a reply so other
  // agents see the "skriver…" state.
  onComposingChange?: (composing: boolean) => void;
}

interface ParsedEmailMessage {
  label: string;
  date: string | null;
  dateRaw: Date | null;
  body: string;
  isOriginal: boolean;
  isSupport: boolean;
  isComment: boolean;
  sentBy?: string | null;
}

function parseEmailThread(
  rawMessage: string,
  finalResponse?: string | null,
  sentAt?: Date | string | null,
  sentBy?: string | null,
): ParsedEmailMessage[] {
  const parts = rawMessage.split(/\n\n---\n(?=\[(Följdmail|Support-svar|Intern kommentar) )/);

  const messages: ParsedEmailMessage[] = parts.map((part, idx) => {
    if (idx === 0) {
      const rawBody = part
        .replace(/^\[Gmail Thread: [^\]]+\]\n/gm, '')
        .replace(/^\[Gmail ID: [^\]]+\]\n/gm, '')
        .replace(/^\[Inbox account: [^\]]+\]\n/gm, '')
        .replace(/^\[Message-Id: [^\]]+\]\n/gm, '')
        .replace(/\n?\[DrabbadHanterad: [^\]]+\]/g, '')
        .trim();
      const body = isHtml(rawBody) ? htmlToText(rawBody) : rawBody;
      return { label: 'Ursprungligt meddelande', date: null, dateRaw: null, body, isOriginal: true, isSupport: false, isComment: false };
    }

    const isSupportMsg = part.startsWith('[Support-svar ');
    const isComment = part.startsWith('[Intern kommentar ');
    const markerMatch = part.match(/^\[(Följdmail|Support-svar|Intern kommentar) ([^\]]+?)(?:\]| av [^\]]+\])/);
    const dateStr = markerMatch ? markerMatch[2] : null;
    const dateRaw = dateStr ? new Date(dateStr.replace(' ', 'T')) : null;

    const agentMatch = part.match(/^\[(?:Support-svar|Intern kommentar) [^\]]+ av ([^\]]+)\]/);
    const agent = agentMatch ? agentMatch[1] : null;

    const bodyLines: string[] = [];
    for (const line of part.split('\n')) {
      if (/^\[(Följdmail |Support-svar |Intern kommentar |Gmail ID:|Gmail Thread:|Inbox account:|Message-Id:|DrabbadHanterad:)/.test(line)) continue;
      if (!isSupportMsg && !isComment && line.startsWith('>')) continue;
      bodyLines.push(line);
    }

    const rawBody = bodyLines.join('\n').trim();
    const body = isHtml(rawBody) ? htmlToText(rawBody) : rawBody;
    return {
      label: isComment ? 'Intern kommentar' : isSupportMsg ? 'Svar från support' : 'Följdmail från kund',
      date: dateStr,
      dateRaw,
      body,
      isOriginal: false,
      isSupport: isSupportMsg,
      isComment,
      sentBy: (isSupportMsg || isComment) ? agent : null,
    };
  });

  // Add finalResponse as a support message if it's not already embedded in the thread
  if (finalResponse && !rawMessage.includes('[Support-svar ')) {
    const dateRaw = sentAt ? new Date(sentAt) : null;
    const dateStr = dateRaw ? dateRaw.toLocaleString('sv-SE') : null;
    messages.push({
      label: 'Svar från support',
      date: dateStr,
      dateRaw,
      body: finalResponse,
      isOriginal: false,
      isSupport: true,
      isComment: false,
      sentBy: sentBy || null,
    });
  }

  // Sort newest first; original message (null date) always last
  messages.sort((a, b) => {
    if (!a.dateRaw && !b.dateRaw) return 0;
    if (!a.dateRaw) return 1;
    if (!b.dateRaw) return -1;
    return b.dateRaw.getTime() - a.dateRaw.getTime();
  });

  return messages;
}

function sortInvoicesDesc(invoices: any[]): any[] {
  return [...invoices].sort((a, b) => {
    const numA = parseInt(a.number || a.invoiceNumber || '0', 10);
    const numB = parseInt(b.number || b.invoiceNumber || '0', 10);
    return numB - numA;
  });
}

export default function TicketDetail({ ticket, onUpdate, onGenerateAI, onSend, onDelete, onSpam, onSelectTicket, viewers = [], onComposingChange }: TicketDetailProps) {
  const [response, setResponse] = useState(ticket.finalResponse || ticket.aiResponse || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(ticket.aiResponse || null);
  const [customerHistory, setCustomerHistory] = useState<CustomerHistoryResponse | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [emailAccounts, setEmailAccounts] = useState<ReplyFromAccount[]>([]);
  const [selectedFromAccount, setSelectedFromAccount] = useState<string>('');
  const [recipientEmail, setRecipientEmail] = useState(ticket.customerEmail);
  const [billectaModalOpen, setBillectaModalOpen] = useState(false);
  const [billectaSearchQuery, setBillectaSearchQuery] = useState('');
  const [billectaSearchType, setBillectaSearchType] = useState<'auto' | 'invoice' | 'orgno'>('auto');
  const [billectaSearchResults, setBillectaSearchResults] = useState<any>(null);
  const [billectaSearching, setBillectaSearching] = useState(false);
  const [stripeModalOpen, setStripeModalOpen] = useState(false);
  const [resendModalOpen, setResendModalOpen] = useState(false);
  const [retoolModalOpen, setRetoolModalOpen] = useState(false);
  const [sendConfirmation, setSendConfirmation] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [inlineImages, setInlineImages] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [popoutTicket, setPopoutTicket] = useState<any>(null);
  const [popoutLoading, setPopoutLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentSaving, setCommentSaving] = useState(false);
  // Lightbox modal for clicking attached images (replaces window.open which
  // is often blocked by browsers for data: URLs).
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  // Active integrations so we can always show the Billecta card when the
  // integration exists, even when no auto-match was found for the customer.
  const [hasBillectaIntegration, setHasBillectaIntegration] = useState(false);
  // Full attachments (with data URLs) for the open ticket. The ticket-list
  // poll strips data URLs to stay light, so we lazy-load them here from the
  // single-ticket endpoint when only metadata is present.
  const [attachments, setAttachments] = useState<Array<{ filename: string; mimeType: string; size?: number; dataUrl?: string }>>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  // "Skrivläge" — track whether this agent is actively composing so the
  // parent can broadcast it. We only fire the callback on transitions and
  // auto-clear after a few seconds of inactivity.
  const composingRef = useRef(false);
  const composingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNavigateToTicket = async (ticketId: string) => {
    setPopoutLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      if (res.ok) {
        const ticketData = await res.json();
        setPopoutTicket(ticketData);
      }
    } catch (error) {
      console.error('Error fetching ticket:', error);
    } finally {
      setPopoutLoading(false);
    }
  };

  const handleBillectaSearch = async () => {
    if (!billectaSearchQuery.trim()) return;
    setBillectaSearching(true);
    setBillectaSearchResults(null);
    try {
      const res = await fetch('/api/billecta/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: billectaSearchQuery.trim(),
          searchType: billectaSearchType === 'auto' ? undefined : billectaSearchType,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBillectaSearchResults(data);
      } else {
        setBillectaSearchResults({ error: data.error || 'Sökning misslyckades' });
      }
    } catch {
      setBillectaSearchResults({ error: 'Nätverksfel vid sökning' });
    } finally {
      setBillectaSearching(false);
    }
  };

  // Fetch connected email accounts for "reply from" selector
  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const res = await fetch('/api/email-accounts');
        if (res.ok) {
          const data = await res.json();
          const accounts: ReplyFromAccount[] = (data.accounts || data || []).filter((a: ReplyFromAccount) => a.isActive);
          setEmailAccounts(accounts);
          if (accounts.length > 0 && !selectedFromAccount) {
            setSelectedFromAccount(accounts[0].id);
          }
        }
      } catch (error) {
        console.error('Error fetching email accounts:', error);
      }
    };
    fetchAccounts();
  }, []);

  // Fetch active integrations to know whether to always show the Billecta
  // card (so users can manually search even without auto-match).
  useEffect(() => {
    const fetchIntegrations = async () => {
      try {
        const res = await fetch('/api/integrations');
        if (res.ok) {
          const data = await res.json();
          const integrations = Array.isArray(data) ? data : data.integrations || [];
          setHasBillectaIntegration(
            integrations.some((i: any) => i.type === 'billecta' && i.isActive !== false)
          );
        }
      } catch (error) {
        console.error('Error fetching integrations:', error);
      }
    };
    fetchIntegrations();
  }, []);

  // Reset editor state only when switching to a different ticket. Earlier the
  // dependency array included ticket.aiResponse / finalResponse / customerEmail,
  // which meant the background poll (every 3s) or a newly-arrived AI response
  // would overwrite whatever the agent was typing. Keying solely on ticket.id
  // preserves in-flight drafts while still resetting when the user opens a
  // different ticket.
  useEffect(() => {
    setResponse(ticket.finalResponse || ticket.aiResponse || '');
    setAiSuggestion(ticket.aiResponse || null);
    setRecipientEmail(ticket.customerEmail);
    setInlineImages([]);
    // Reset composing state when switching tickets. The parent clears the
    // old ticket's presence on selection change, so we just reset locally.
    composingRef.current = false;
    if (composingTimerRef.current) {
      clearTimeout(composingTimerRef.current);
      composingTimerRef.current = null;
    }
  }, [ticket.id]);

  // Load the customer's attachments for this ticket. The list payload only
  // carries metadata (no data URLs), so when bytes are missing we fetch the
  // full ticket once. Keyed on ticket.id so the 3s poll doesn't refetch.
  useEffect(() => {
    const meta = ticket.contextData?.attachments;
    if (!meta || meta.length === 0) {
      setAttachments([]);
      return;
    }
    // Already have the bytes (e.g. ticket came from a full fetch).
    if (meta.every((a: any) => a.dataUrl)) {
      setAttachments(meta as any);
      return;
    }
    let cancelled = false;
    setAttachmentsLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/tickets/${ticket.id}`);
        if (!res.ok || cancelled) return;
        const full = await res.json();
        const fa = full?.contextData?.attachments;
        if (!cancelled && Array.isArray(fa)) setAttachments(fa);
      } catch {
        // leave as metadata-only; the count still shows
      } finally {
        if (!cancelled) setAttachmentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  // Only clear the send confirmation when switching to a different ticket
  useEffect(() => {
    setSendConfirmation(null);
  }, [ticket.id]);

  useEffect(() => {
    let isCancelled = false;

    const fetchCustomerHistory = async () => {
      setIsHistoryLoading(true);
      try {
        const res = await fetch(`/api/tickets/${ticket.id}/customer-history`);
        if (!res.ok) {
          if (!isCancelled) {
            setCustomerHistory(null);
          }
          return;
        }

        const data = await res.json();
        if (!isCancelled) {
          setCustomerHistory(data);
        }
      } catch (error) {
        console.error('Error fetching customer history:', error);
        if (!isCancelled) {
          setCustomerHistory(null);
        }
      } finally {
        if (!isCancelled) {
          setIsHistoryLoading(false);
        }
      }
    };

    fetchCustomerHistory();

    // Refresh customer integrations (Stripe/Billecta/Resend/Retool) when
    // a ticket is opened so support sees current state without having to
    // regenerate the AI reply first. Runs in the background — if it
    // fails we just keep whatever contextData we already had.
    const refreshContext = async () => {
      try {
        await fetch(`/api/tickets/${ticket.id}/refresh-context`, { method: 'POST' });
        // The endpoint persists contextData via raw SQL without touching
        // updatedAt. The 3-second poll will pick up the fresh data.
        // Do NOT call onUpdate here — that triggers a PATCH which bumps
        // updatedAt and moves this ticket to the top of the sorted list.
      } catch (error) {
        console.error('Error refreshing ticket context:', error);
      }
    };

    refreshContext();

    return () => {
      isCancelled = true;
    };
  }, [ticket.id]);

  const handleGenerateAI = async () => {
    setIsGenerating(true);
    const aiResponse = await onGenerateAI(ticket.id);
    if (aiResponse) {
      setAiSuggestion(aiResponse);
      setResponse(aiResponse);
    }
    setIsGenerating(false);
  };

  const handleAIFeedback = async (rating: 'positive' | 'negative') => {
    if (!aiSuggestion) return;

    try {
      await fetch('/api/ai-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: ticket.id,
          aiResponse: aiSuggestion,
          finalResponse: response,
          rating,
          knowledgeUsed: [], // TODO: Track which KB articles were used
        }),
      });

      // Show brief feedback confirmation
      console.log(`AI feedback recorded: ${rating}`);
    } catch (error) {
      console.error('Error saving AI feedback:', error);
    }
  };

  const isSendingRef = useRef(false);

  const handleSend = async () => {
    if (!response || isSendingRef.current) return;
    isSendingRef.current = true;
    setIsSending(true);
    setSendConfirmation(null);

    // Save feedback if AI was used and response was edited
    if (aiSuggestion && response !== aiSuggestion) {
      await fetch('/api/ai-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: ticket.id,
          aiResponse: aiSuggestion,
          finalResponse: response,
          rating: null, // No explicit rating, just tracking the edit
          knowledgeUsed: [],
        }),
      });
    }

    // Update recipient email if changed
    if (recipientEmail !== ticket.customerEmail) {
      await onUpdate(ticket.id, { customerEmail: recipientEmail });
    }

    // Build HTML response with inline images if any
    let finalResponseContent = response;
    if (inlineImages.length > 0) {
      const imagesHtml = inlineImages
        .map(img => `<br/><img src="${img.dataUrl}" alt="${img.name}" style="max-width:600px;"/>`)
        .join('');
      finalResponseContent = response + '\n[INLINE_IMAGES]' + imagesHtml;
    }

    const result = await onSend(ticket.id, finalResponseContent, selectedFromAccount || undefined, recipientEmail);
    isSendingRef.current = false;
    setIsSending(false);

    if (result.ok) {
      const fromAccount = emailAccounts.find(a => a.id === selectedFromAccount);
      setSendConfirmation({
        type: 'success',
        message: `Mailet har skickats till ${recipientEmail}${fromAccount ? ` från ${fromAccount.email}` : ''} och lagts i skickade.`,
      });
      setTimeout(() => setSendConfirmation(null), 10000);
    } else {
      setSendConfirmation({
        type: 'error',
        message: result.error
          ? `Mailet kunde inte skickas: ${result.error}`
          : 'Mailet kunde inte skickas. Försök igen.',
      });
      // Leave the error visible longer so support can read it.
      setTimeout(() => setSendConfirmation(null), 20000);
    }
  };

  const handleAssign = (agent: string) => {
    // Empty string means "unassign"
    onUpdate(ticket.id, { assignedTo: agent || null } as any);
  };

  const handlePriority = (priority: string) => {
    onUpdate(ticket.id, { priority } as any);
  };

  const setComposing = (next: boolean) => {
    if (composingRef.current === next) return;
    composingRef.current = next;
    onComposingChange?.(next);
  };
  // Called on every keystroke/focus in the reply box. Marks us as composing
  // and (re)arms an inactivity timer that clears the state after 4s.
  const noteTyping = () => {
    setComposing(true);
    if (composingTimerRef.current) clearTimeout(composingTimerRef.current);
    composingTimerRef.current = setTimeout(() => setComposing(false), 4000);
  };
  const stopComposing = () => {
    if (composingTimerRef.current) {
      clearTimeout(composingTimerRef.current);
      composingTimerRef.current = null;
    }
    setComposing(false);
  };

  const handleStatusChange = (status: string) => {
    onUpdate(ticket.id, { status: status as any });
    // Closing a ticket from the detail view should also remove it from our
    // active view so support isn't left staring at a solved ticket.
    if (status === 'closed') {
      onSelectTicket?.(null);
    }
  };

  const handleDelete = () => {
    if (confirm('Är du säker på att du vill ta bort detta ärende? Detta kan inte ångras.')) {
      onDelete?.(ticket.id);
    }
  };

  const handleSpam = () => {
    if (confirm('Markera detta ärende som spam?')) {
      onSpam?.(ticket.id);
    }
  };

  const handleClose = () => {
    if (confirm('Stäng detta ärende? Du kan hitta det senare under fliken "Stängda".')) {
      handleStatusChange('closed');
    }
  };

  const handleMarkResolved = () => {
    handleStatusChange('closed');
  };

  const handleAddComment = async () => {
    if (!commentText.trim() || commentSaving) return;
    setCommentSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: commentText.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdate(ticket.id, { originalMessage: updated.originalMessage } as any);
        setCommentText('');
        setCommentOpen(false);
      }
    } finally {
      setCommentSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm h-full flex flex-col">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        {/* AI Status Banner */}
        {ticket.aiResponse && (
          <div className="mb-3 p-2.5 bg-gradient-to-r from-[#7C5CFF]/10 to-[#9F7BFF]/10 border border-[#7C5CFF]/30 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] flex items-center justify-center">
                  <span className="text-white text-xs">✨</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#7C5CFF] dark:text-[#9F7BFF]">AI-svar genererat</p>
                </div>
              </div>
              {ticket.aiConfidence && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 dark:text-slate-400">Säkerhet:</span>
                  <span className="px-2.5 py-0.5 bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-full text-xs font-bold">
                    {Math.round(ticket.aiConfidence * 100)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1.5">{ticket.subject}</h2>
            <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
              <span>{ticket.customerEmail}</span>
              <span>•</span>
              <span suppressHydrationWarning>{new Date(ticket.createdAt).toLocaleString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Priority traffic light — rank the customer röd/gul/grön. */}
            <div className="flex items-center gap-1 pr-1" role="group" aria-label="Prioritet">
              {PRIORITY_LIGHTS.map((p) => {
                const active = priorityToLight(ticket.priority) === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handlePriority(p.value)}
                    aria-pressed={active}
                    title={`Prioritet: ${p.label}`}
                    aria-label={`Sätt prioritet ${p.label}`}
                    className={`w-5 h-5 rounded-full ${p.dot} transition-all ${
                      active
                        ? `ring-2 ring-offset-1 ${p.ring} ring-offset-white dark:ring-offset-slate-800`
                        : 'opacity-30 hover:opacity-70'
                    }`}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-1.5">
              <UserCircle2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              {(() => {
                const color = ticket.assignedTo ? agentColor(ticket.assignedTo) : null;
                return (
                  <select
                    value={ticket.assignedTo || ''}
                    onChange={(e) => handleAssign(e.target.value)}
                    className="px-3 py-1 text-sm rounded-md font-semibold"
                    style={
                      color
                        ? {
                            backgroundColor: color.bg,
                            color: color.text,
                            border: `1px solid ${color.border}`,
                          }
                        : undefined
                    }
                    title="Tilldela ärende"
                  >
                    <option value="">Tilldela…</option>
                    {AGENTS.map((agent) => (
                      <option key={agent} value={agent}>{agent}</option>
                    ))}
                  </select>
                );
              })()}
            </div>
            <select
              value={ticket.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="px-3 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            >
              <option value="new">{statusLabelSv('new')}</option>
              <option value="in_progress">{statusLabelSv('in_progress')}</option>
              <option value="review">{statusLabelSv('review')}</option>
              <option value="sent">{statusLabelSv('sent')}</option>
              <option value="closed">{statusLabelSv('closed')}</option>
            </select>
            {ticket.status !== 'closed' && (
              <button
                onClick={handleMarkResolved}
                className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors inline-flex items-center gap-1.5"
                title="Markera som löst och stäng"
              >
                <CheckCircle2 className="w-4 h-4" />
                Löst
              </button>
            )}
            {onSpam && (
              <button
                onClick={handleSpam}
                className="p-2 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded transition-colors"
                title="Markera som spam"
              >
                <AlertOctagon className="w-4 h-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={handleDelete}
                className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                title="Ta bort ärende"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {viewers.length > 0 && (() => {
          const typing = viewers.filter((v) => v.typing);
          const firstNames = (list: DetailViewer[]) =>
            list.map((v) => v.name?.split(' ')[0] || v.email).join(', ');
          if (typing.length > 0) {
            return (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-sm">
                <Pencil className="w-4 h-4 animate-pulse flex-shrink-0" />
                <span><strong>{firstNames(typing)}</strong> skriver just nu ett svar till kunden…</span>
              </div>
            );
          }
          return (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm">
              <UserCircle2 className="w-4 h-4 flex-shrink-0" />
              <span><strong>{firstNames(viewers)}</strong> tittar också på det här ärendet just nu.</span>
            </div>
          );
        })()}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">E-postkonversation</h3>
            <button
              onClick={() => setCommentOpen((v) => !v)}
              className="px-2.5 py-1 text-xs font-medium rounded-md border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            >
              + Intern kommentar
            </button>
          </div>
          {commentOpen && (
            <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-3">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Skriv intern kommentar (syns inte för kunden)…"
                className="w-full h-24 text-sm p-2 rounded border border-amber-200 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => { setCommentOpen(false); setCommentText(''); }} className="px-3 py-1 text-xs text-slate-600 dark:text-slate-400 hover:underline">Avbryt</button>
                <button
                  onClick={handleAddComment}
                  disabled={!commentText.trim() || commentSaving}
                  className="px-3 py-1 text-xs font-medium rounded-md bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50"
                >
                  {commentSaving ? 'Sparar…' : 'Spara kommentar'}
                </button>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {parseEmailThread(ticket.originalMessage, ticket.finalResponse, ticket.sentAt, ticket.sentBy).map((msg, idx, arr) => (
              <div
                key={idx}
                className={`rounded-lg border p-4 ${
                  msg.isOriginal
                    ? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                    : msg.isComment
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-600'
                    : msg.isSupport
                    ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
                    : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-semibold ${
                    msg.isOriginal
                      ? 'text-slate-500 dark:text-slate-400'
                      : msg.isComment
                      ? 'text-amber-700 dark:text-amber-400'
                      : msg.isSupport
                      ? 'text-green-700 dark:text-green-300'
                      : 'text-blue-700 dark:text-blue-300'
                  }`}>
                    {msg.label}
                    {msg.sentBy && (
                      <span className="ml-1 font-normal opacity-80">· {msg.sentBy}</span>
                    )}
                    {arr.length > 1 && (
                      <span className="ml-2 text-[10px] font-normal opacity-60">
                        ({idx + 1}/{arr.length})
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500" suppressHydrationWarning>
                    {msg.date ?? new Date(ticket.createdAt).toLocaleString('sv-SE')}
                  </span>
                </div>
                <div className="text-sm whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                  {msg.body || <span className="italic text-slate-400">(tomt)</span>}
                </div>
              </div>
            ))}
          </div>
          {ticket.contextData?.attachments && ticket.contextData.attachments.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                Bifogade filer ({ticket.contextData.attachments.length})
              </p>
              {attachmentsLoading && attachments.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Laddar bifogade filer…
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {attachments.map((att, idx: number) => {
                    const isImage = att.mimeType?.startsWith('image/') && att.dataUrl;
                    if (isImage) {
                      return (
                        <div key={idx} className="relative group">
                          <button
                            type="button"
                            onClick={() => att.dataUrl && setLightboxImage({ src: att.dataUrl, alt: att.filename })}
                            className="block focus:outline-none focus:ring-2 focus:ring-[#7C5CFF] rounded-lg"
                            aria-label={`Öppna bild ${att.filename}`}
                          >
                            <img
                              src={att.dataUrl}
                              alt={att.filename}
                              className="max-w-[200px] max-h-[200px] rounded-lg border border-slate-200 dark:border-slate-700 object-cover cursor-zoom-in hover:shadow-lg hover:border-[#7C5CFF]/40 transition-all"
                            />
                          </button>
                          <p className="text-[10px] text-slate-400 mt-1 truncate max-w-[200px]">{att.filename}</p>
                        </div>
                      );
                    }
                    // Non-image file (PDF, doc, …) — offer a download.
                    return (
                      <a
                        key={idx}
                        href={att.dataUrl}
                        download={att.filename}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:border-[#7C5CFF]/40 hover:shadow-sm transition-all max-w-[240px]"
                        title={`Ladda ner ${att.filename}`}
                      >
                        <FileText className="w-5 h-5 text-slate-400 flex-shrink-0" />
                        <span className="text-xs text-slate-700 dark:text-slate-300 truncate flex-1">{att.filename}</span>
                        <Download className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300">Kundhistorik (e-postbaserad)</h3>

          {isHistoryLoading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Laddar kundhistorik...</p>
          ) : !customerHistory ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Ingen kundhistorik hittades.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="bg-white dark:bg-slate-800 rounded-md p-3 border border-slate-200 dark:border-slate-700">
                  <p className="text-slate-500 dark:text-slate-400">Kund</p>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {customerHistory.customer.name || customerHistory.customer.email}
                  </p>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-md p-3 border border-slate-200 dark:border-slate-700">
                  <p className="text-slate-500 dark:text-slate-400">Totalt antal ärenden</p>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{customerHistory.customer.totalTickets}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-md p-3 border border-slate-200 dark:border-slate-700">
                  <p className="text-slate-500 dark:text-slate-400">Öppna ärenden</p>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{customerHistory.customer.openTickets}</p>
                </div>
              </div>

              {customerHistory.previousTickets.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Tidigare ärenden ({customerHistory.previousTickets.length})</p>
                  <div className="space-y-1">
                    {customerHistory.previousTickets.map((prevTicket) => (
                      <div
                        key={prevTicket.id}
                        onClick={() => handleNavigateToTicket(prevTicket.id)}
                        className="flex items-center gap-2 px-2 py-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-[#7C5CFF]/40 transition-all text-xs"
                      >
                        <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${
                          prevTicket.status === 'closed' || prevTicket.status === 'sent'
                            ? 'bg-green-500'
                            : 'bg-amber-500'
                        }`} />
                        <span className="font-medium text-slate-900 dark:text-slate-100 truncate flex-1">{prevTicket.subject}</span>
                        <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">{new Date(prevTicket.createdAt).toLocaleDateString('sv-SE')}</span>
                        <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">{prevTicket.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Liknande ärenden</p>
                {customerHistory.similarIssues.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">Inga liknande ärenden hittades.</p>
                ) : (
                  <div className="space-y-1">
                    {customerHistory.similarIssues.map((issue) => (
                      <div
                        key={issue.id}
                        onClick={() => handleNavigateToTicket(issue.id)}
                        className="flex items-center gap-2 px-2 py-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-[#7C5CFF]/40 transition-all text-xs"
                      >
                        <span className="px-1.5 py-0.5 rounded bg-[#7C5CFF]/15 text-[#7C5CFF] dark:text-[#B8A6FF] font-medium flex-shrink-0">
                          {issue.similarityScore}%
                        </span>
                        <span className="font-medium text-slate-900 dark:text-slate-100 truncate flex-1">{issue.subject}</span>
                        <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">{new Date(issue.createdAt).toLocaleDateString('sv-SE')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {(ticket.contextData || hasBillectaIntegration) && (
          <div>
            <h3 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300">Kundinformation</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ticket.contextData?.stripe && (
                <div
                  onClick={() => setStripeModalOpen(true)}
                  className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 rounded-lg p-4 border border-blue-200 dark:border-blue-800 cursor-pointer hover:shadow-md hover:border-blue-400 dark:hover:border-blue-600 transition-all"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">S</span>
                    </div>
                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">Stripe</p>
                    <ChevronDown className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 ml-auto" />
                  </div>
                  {ticket.contextData.stripe.accountClosed && (() => {
                    const canceledSub = ticket.contextData.stripe?.subscriptions?.find((s: any) => s.canceledAt || s.endedAt);
                    const closedDate = canceledSub?.canceledAt || canceledSub?.endedAt;
                    return (
                      <div className="mb-2 px-2 py-1 bg-red-100 dark:bg-red-900/50 border border-red-300 dark:border-red-700 rounded text-xs font-semibold text-red-800 dark:text-red-300">
                        Konto avslutat{closedDate ? ` ${new Date(closedDate * 1000).toLocaleDateString('sv-SE')}` : ''}
                      </div>
                    );
                  })()}
                  <div className="space-y-1 text-xs text-blue-800 dark:text-blue-200">
                    <p>💳 {ticket.contextData.stripe.subscriptions?.length || 0} prenumerationer</p>
                    <p>📄 {ticket.contextData.stripe.invoices?.length || 0} fakturor</p>
                    <p>💰 {ticket.contextData.stripe.charges?.length || 0} betalningar</p>
                  </div>
                  <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-2">Klicka för detaljer</p>
                </div>
              )}
              {(ticket.contextData?.billecta || customerHistory?.billecta || hasBillectaIntegration) && (() => {
                const bc = ticket.contextData?.billecta;
                const hb = customerHistory?.billecta;
                const invoices = bc?.invoices || hb?.invoicesPreview || [];
                const totalInvoices = hb?.invoices ?? invoices.length;
                const unpaidCount = hb?.unpaidInvoices ?? invoices.filter((i: any) => !i.isPaid).length;
                const debtorName = bc?.debtorName || null;
                const debtorStatus = bc?.debtorStatus || null;
                const hasAnyData = Boolean(bc || hb);

                return (
                  <div
                    onClick={() => setBillectaModalOpen(true)}
                    className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 rounded-lg p-4 border border-green-200 dark:border-green-800 cursor-pointer hover:shadow-md hover:border-green-400 dark:hover:border-green-600 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center">
                        <span className="text-white text-xs font-bold">B</span>
                      </div>
                      <p className="text-sm font-semibold text-green-900 dark:text-green-100">Billecta</p>
                      <Search className="w-3.5 h-3.5 text-green-600 dark:text-green-400 ml-auto" />
                    </div>
                    {debtorName && (
                      <p className="text-xs font-medium text-green-800 dark:text-green-200 mb-1">{debtorName}</p>
                    )}
                    {debtorStatus && (
                      <div className={`mb-1 px-2 py-0.5 rounded text-xs font-semibold inline-block ${debtorStatus === 'Active' ? 'bg-green-200 dark:bg-green-800 text-green-900 dark:text-green-100' : 'bg-red-100 dark:bg-red-900/50 border border-red-300 dark:border-red-700 text-red-800 dark:text-red-300'}`}>
                        {debtorStatus === 'Active' ? 'Aktivt konto' : `Konto: ${debtorStatus}`}
                        {bc?.debtorClosedDate ? ` (${new Date(bc.debtorClosedDate).toLocaleDateString('sv-SE')})` : ''}
                      </div>
                    )}
                    {hasAnyData ? (
                      <div className="flex gap-4 text-xs text-green-800 dark:text-green-200">
                        <span>📋 {totalInvoices} fakturor</span>
                        {unpaidCount > 0 && (
                          <span className="text-amber-700 dark:text-amber-400">⚠ {unpaidCount} obetalda</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-green-800 dark:text-green-200">
                        <p>Ingen automatisk träff på kundens e-post.</p>
                      </div>
                    )}
                    <p className="text-[10px] text-green-600 dark:text-green-400 mt-2">
                      {hasAnyData ? 'Klicka för fakturor & sök' : 'Klicka för att söka manuellt'}
                    </p>
                  </div>
                );
              })()}
              {ticket.contextData?.resend && (
                <div
                  onClick={() => setResendModalOpen(true)}
                  className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 rounded-lg p-4 border border-purple-200 dark:border-purple-800 cursor-pointer hover:shadow-md hover:border-purple-400 dark:hover:border-purple-600 transition-all"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">R</span>
                    </div>
                    <p className="text-sm font-semibold text-purple-900 dark:text-purple-100">Resend</p>
                    <span className="text-[9px] text-purple-600 dark:text-purple-400 ml-auto">senaste 7d</span>
                  </div>
                  <div className="space-y-1 text-xs text-purple-800 dark:text-purple-200">
                    <p>📧 {ticket.contextData.resend.emailsSent || 0} skickade mail</p>
                    <p>📬 {ticket.contextData.resend.recentEmails?.length || 0} senaste mail</p>
                  </div>
                  <p className="text-[10px] text-purple-600 dark:text-purple-400 mt-2">Klicka för detaljer</p>
                </div>
              )}
              {ticket.contextData?.retool && (
                <div
                  onClick={() => setRetoolModalOpen(true)}
                  className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900 rounded-lg p-4 border border-orange-200 dark:border-orange-800 cursor-pointer hover:shadow-md hover:border-orange-400 dark:hover:border-orange-600 transition-all"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">RT</span>
                    </div>
                    <p className="text-sm font-semibold text-orange-900 dark:text-orange-100">Retool</p>
                    <ChevronDown className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 ml-auto" />
                  </div>
                  <div className="space-y-1 text-xs text-orange-800 dark:text-orange-200">
                    <p>🔧 Kunddata tillgänglig</p>
                  </div>
                  <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-2">Klicka för detaljer</p>
                </div>
              )}
              {ticket.contextData?.clerk && (
                <div className="bg-gradient-to-br from-sky-50 to-sky-100 dark:from-sky-950 dark:to-sky-900 rounded-lg p-4 border border-sky-200 dark:border-sky-800">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">C</span>
                    </div>
                    <p className="text-sm font-semibold text-sky-900 dark:text-sky-100">Clerk</p>
                    {ticket.contextData.clerk.plan && (
                      <span className="text-[9px] text-sky-600 dark:text-sky-400 ml-auto">{ticket.contextData.clerk.plan}</span>
                    )}
                  </div>
                  <div className="space-y-1 text-xs text-sky-800 dark:text-sky-200">
                    <p>👤 Konto finns{ticket.contextData.clerk.emailVerified ? ' · verifierad' : ' · ej verifierad'}</p>
                    {ticket.contextData.clerk.createdAt && (
                      <p>📅 Skapat {new Date(ticket.contextData.clerk.createdAt).toLocaleDateString('sv-SE')}</p>
                    )}
                    {ticket.contextData.clerk.lastSignInAt && (
                      <p>🔑 Senaste inloggning {new Date(ticket.contextData.clerk.lastSignInAt).toLocaleDateString('sv-SE')}</p>
                    )}
                    {(ticket.contextData.clerk.banned || ticket.contextData.clerk.locked) && (
                      <p className="text-red-600 dark:text-red-400">⚠️ {ticket.contextData.clerk.banned ? 'Bannat' : 'Låst'} konto</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* AI Suggestion Section */}
        {aiSuggestion && (
          <div className="bg-gradient-to-r from-[#7C5CFF]/10 to-[#9F7BFF]/10 border border-[#7C5CFF]/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] flex items-center justify-center">
                  <span className="text-white text-xs">✨</span>
                </div>
                <p className="text-sm font-semibold text-[#7C5CFF] dark:text-[#9F7BFF]">AI-förslag till svar</p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleAIFeedback('positive')}
                  className="p-1.5 rounded-md hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                  title="Bra svar"
                >
                  <span className="text-lg">👍</span>
                </button>
                <button
                  onClick={() => handleAIFeedback('negative')}
                  className="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                  title="Dåligt svar"
                >
                  <span className="text-lg">👎</span>
                </button>
              </div>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{aiSuggestion}</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setResponse(aiSuggestion)}
                className="px-3 py-1 text-xs bg-[#7C5CFF] text-white rounded-md hover:bg-[#6B4FE0]"
              >
                Använd detta svar
              </button>
              <button
                onClick={handleGenerateAI}
                disabled={isGenerating}
                className="px-3 py-1 text-xs border border-[#7C5CFF] text-[#7C5CFF] rounded-md hover:bg-[#7C5CFF]/10"
              >
                {isGenerating ? 'Genererar om…' : 'Generera om'}
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Svar</h3>
            {!aiSuggestion && (
              <button
                onClick={handleGenerateAI}
                disabled={isGenerating}
                className="px-3 py-1 text-sm bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-md hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(124,92,255,0.4)]"
              >
                {isGenerating ? 'Genererar…' : '✨ Generera AI-svar'}
              </button>
            )}
          </div>
          <textarea
            value={response}
            onChange={(e) => { setResponse(e.target.value); noteTyping(); }}
            onFocus={noteTyping}
            onBlur={stopComposing}
            className="w-full h-64 p-4 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
            placeholder="Skriv ditt svar eller generera ett med AI…"
          />
          <div className="mt-2 flex items-center gap-2">
            <label className="px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 cursor-pointer transition-colors">
              Bifoga bild
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files) return;
                  Array.from(files).forEach(file => {
                    if (file.size > 2 * 1024 * 1024) return; // max 2MB
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const dataUrl = ev.target?.result as string;
                      if (dataUrl) {
                        setInlineImages(prev => [...prev, { name: file.name, dataUrl }]);
                      }
                    };
                    reader.readAsDataURL(file);
                  });
                  e.target.value = '';
                }}
              />
            </label>
            {inlineImages.length > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">{inlineImages.length} bild(er) bifogade</span>
            )}
          </div>
          {inlineImages.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {inlineImages.map((img, idx) => (
                <div key={idx} className="relative group">
                  <img src={img.dataUrl} alt={img.name} className="w-16 h-16 object-cover rounded border border-slate-200 dark:border-slate-700" />
                  <button
                    onClick={() => setInlineImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                  <p className="text-[9px] text-slate-400 truncate max-w-[64px]">{img.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-6 border-t border-slate-200 dark:border-slate-700">
        {/* Recipient Email Editor */}
        <div className="mb-3 flex items-center gap-2">
          <Mail className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
          <span className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">Till:</span>
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            className="flex-1 px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
            placeholder="mottagare@example.com"
          />
        </div>
        {/* Reply From Selector */}
        {emailAccounts.length > 0 && (
          <div className="mb-3 flex items-center gap-2">
            <Mail className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
            <span className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">Svara från:</span>
            <div className="relative flex-1">
              <select
                value={selectedFromAccount}
                onChange={(e) => setSelectedFromAccount(e.target.value)}
                className="w-full appearance-none pl-3 pr-8 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
              >
                {emailAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.email}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>
        )}
        {sendConfirmation && (
          <div
            role="status"
            aria-live="polite"
            className={`mb-3 p-4 rounded-lg text-sm font-semibold flex items-start gap-3 shadow-md ${
              sendConfirmation.type === 'error'
                ? 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border-2 border-red-400 dark:border-red-700'
                : 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200 border-2 border-green-400 dark:border-green-700'
            }`}
          >
            {sendConfirmation.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
            ) : (
              <AlertOctagon className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
            )}
            <div className="flex-1">
              <p className="text-sm">{sendConfirmation.message}</p>
            </div>
            <button
              onClick={() => setSendConfirmation(null)}
              className="flex-shrink-0 p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Stäng bekräftelse"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={handleSend}
            disabled={!response || isSending}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
          >
            {isSending ? 'Skickar…' : `Skicka svar${emailAccounts.length > 0 && selectedFromAccount ? ` (${emailAccounts.find(a => a.id === selectedFromAccount)?.email || ''})` : ''}`}
          </button>
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-md font-medium transition-colors"
          >
            Stäng ärende
          </button>
        </div>
      </div>

      {/* Billecta Search Modal */}
      {billectaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setBillectaModalOpen(false)}>
          <div
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-green-600 flex items-center justify-center">
                  <span className="text-white text-sm font-bold">B</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Sök i Billecta</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Sök på kundnummer, fakturanummer eller personnummer</p>
                </div>
              </div>
              <button
                onClick={() => setBillectaModalOpen(false)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Form */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-700">
              <div className="flex gap-2">
                <select
                  value={billectaSearchType}
                  onChange={(e) => setBillectaSearchType(e.target.value as any)}
                  className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                >
                  <option value="auto">Auto</option>
                  <option value="invoice">Fakturanr</option>
                  <option value="orgno">Person/Orgnr</option>
                </select>
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={billectaSearchQuery}
                    onChange={(e) => setBillectaSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleBillectaSearch()}
                    placeholder="Ange kundnummer, fakturanummer, personnummer eller namn..."
                    className="w-full px-4 py-2 pl-10 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-green-500"
                    autoFocus
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                </div>
                <button
                  onClick={handleBillectaSearch}
                  disabled={billectaSearching || !billectaSearchQuery.trim()}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {billectaSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Sök
                </button>
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-auto p-5">
              {billectaSearching && (
                <div className="flex items-center justify-center py-12 text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin mr-2" />
                  <span className="text-sm">Söker i Billecta...</span>
                </div>
              )}

              {!billectaSearching && billectaSearchResults?.error && (
                <div className="p-4 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
                  {billectaSearchResults.error}
                </div>
              )}

              {!billectaSearching && billectaSearchResults?.type === 'empty' && (
                <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                  <p className="text-sm">Inga resultat hittades för &quot;{billectaSearchQuery}&quot;</p>
                </div>
              )}

              {!billectaSearching && billectaSearchResults?.type === 'invoice' && (
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Faktura</p>
                  {sortInvoicesDesc(billectaSearchResults.results).map((inv: any, idx: number) => (
                    <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">Faktura #{inv.invoiceNumber}</p>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          inv.isPaid
                            ? 'border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                            : 'border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                        }`}>
                          {inv.stage}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-slate-500 dark:text-slate-400 text-xs">Kund</p>
                          <p className="text-slate-900 dark:text-slate-100">{inv.debtorName || '-'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400 text-xs">Belopp</p>
                          <p className="text-slate-900 dark:text-slate-100 font-medium">
                            {inv.currentAmount ?? inv.invoicedAmount ?? '-'} {inv.currency}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400 text-xs">Fakturadatum</p>
                          <p className="text-slate-900 dark:text-slate-100">{inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('sv-SE') : '-'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400 text-xs">Förfallodatum</p>
                          <p className="text-slate-900 dark:text-slate-100">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('sv-SE') : '-'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400 text-xs">Leveranssätt</p>
                          <p className="text-slate-900 dark:text-slate-100">{inv.deliveryMethod || '-'}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!billectaSearching && billectaSearchResults?.type === 'debtor' && (
                <div className="space-y-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">
                    Kunder ({billectaSearchResults.results.length})
                  </p>
                  {billectaSearchResults.results.map((debtor: any, idx: number) => (
                    <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{debtor.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{debtor.orgNo || ''} {debtor.email ? `• ${debtor.email}` : ''}</p>
                          {debtor.address && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">{debtor.address}, {debtor.zipCode} {debtor.city}</p>
                          )}
                        </div>
                      </div>

                      {debtor.openInvoices.length > 0 ? (
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-2">
                            Öppna fakturor ({debtor.openInvoices.length})
                          </p>
                          <div className="space-y-2">
                            {sortInvoicesDesc(debtor.openInvoices).map((inv: any, invIdx: number) => (
                              <div key={invIdx} className="rounded-md border border-slate-100 dark:border-slate-600 p-2.5 text-sm">
                                <div className="flex items-center justify-between">
                                  <p className="font-medium text-slate-900 dark:text-slate-100">#{inv.invoiceNumber}</p>
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    inv.isPaid
                                      ? 'border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                                      : 'border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                                  }`}>
                                    {inv.stage}
                                  </span>
                                </div>
                                <div className="flex gap-4 mt-1 text-xs text-slate-600 dark:text-slate-300">
                                  <span>Belopp: {inv.currentAmount ?? '-'} kr</span>
                                  <span>Förfaller: {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('sv-SE') : '-'}</span>
                                  {inv.deliveryMethod && <span>Leverans: {inv.deliveryMethod}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 dark:text-slate-400">Inga öppna fakturor</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!billectaSearching && !billectaSearchResults && (() => {
                const bc = ticket.contextData?.billecta;
                const hb = customerHistory?.billecta;
                const invoices = sortInvoicesDesc(bc?.invoices || hb?.invoicesPreview || []);
                const debtorName = bc?.debtorName || null;
                const debtorOrgNo = bc?.debtorOrgNo || null;

                if (invoices.length === 0) {
                  return (
                    <div className="text-center py-12 text-slate-400 dark:text-slate-500">
                      <Search className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">Inga fakturor kopplade till denna kund</p>
                      <p className="text-xs mt-1">Sök på kundnummer, fakturanummer, personnummer/orgnr eller namn</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    {(debtorName || debtorOrgNo) && (
                      <div className="flex items-center gap-3 pb-3 border-b border-slate-200 dark:border-slate-700">
                        <div className="w-9 h-9 rounded-full border border-green-300 dark:border-green-700 flex items-center justify-center">
                          <span className="text-green-700 dark:text-green-300 text-sm font-bold">
                            {(debtorName || '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          {debtorName && <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{debtorName}</p>}
                          {debtorOrgNo && <p className="text-xs text-slate-500 dark:text-slate-400">{debtorOrgNo}</p>}
                        </div>
                      </div>
                    )}

                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">
                      Fakturor ({invoices.length})
                    </p>
                    <div className="space-y-2">
                      {invoices.map((inv: any, idx: number) => (
                        <div key={`ctx-inv-${idx}`} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                          <div className="flex items-center justify-between mb-1">
                            <p className="font-medium text-sm text-slate-900 dark:text-slate-100">
                              #{inv.number || inv.id || 'Okänd'}
                            </p>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              inv.isPaid
                                ? 'border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                                : 'border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                            }`}>
                              {inv.status || (inv.isPaid ? 'Betald' : 'Obetald')}
                            </span>
                          </div>
                          <div className="flex gap-4 text-xs text-slate-600 dark:text-slate-300">
                            <span>Belopp: {inv.amount ?? '-'} kr</span>
                            <span>Förfaller: {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('sv-SE') : '-'}</span>
                            {inv.deliveryMethod && <span>Leverans: {inv.deliveryMethod}</span>}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700 text-center">
                      <p className="text-xs text-slate-400 dark:text-slate-500">Använd sökfältet ovan för att hitta fler fakturor eller kunder</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {/* Stripe Detail Modal */}
      {stripeModalOpen && ticket.contextData?.stripe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setStripeModalOpen(false)}>
          <div
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
                  <span className="text-white text-sm font-bold">S</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stripe</h2>
                  {ticket.contextData.stripe.customerId && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">Kund: {ticket.contextData.stripe.customerId}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setStripeModalOpen(false)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-6">
              {ticket.contextData.stripe.accountClosed && (
                <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300">Konto avslutat - Alla prenumerationer är avslutade</p>
                </div>
              )}
              {ticket.contextData.stripe.subscriptions && ticket.contextData.stripe.subscriptions.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-3">
                    Prenumerationer ({ticket.contextData.stripe.subscriptions.length})
                  </p>
                  <div className="space-y-2">
                    {ticket.contextData.stripe.subscriptions.map((sub: any, idx: number) => (
                      <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{sub.id}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            sub.status === 'active'
                              ? 'border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                              : 'border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                          }`}>
                            {sub.status}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
                          {sub.currentPeriodEnd && (
                            <span>Nuvarande period slutar: {new Date(sub.currentPeriodEnd * 1000).toLocaleDateString('sv-SE')}</span>
                          )}
                          {sub.canceledAt && (
                            <span className="text-red-600 dark:text-red-400">Uppsägning begärd: {new Date(sub.canceledAt * 1000).toLocaleDateString('sv-SE')}</span>
                          )}
                          {/* The actual end date the customer cares about: when it
                              already ended (endedAt), otherwise the scheduled end
                              (cancelAt), otherwise the current period end. Always
                              show it when the sub is cancelled — previously this was
                              hidden whenever canceledAt was set, so agents saw only
                              the (earlier) request date and read the wrong year. */}
                          {(sub.endedAt || sub.cancelAt) && (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              {sub.endedAt ? 'Upphörde: ' : 'Upphör: '}
                              {new Date((sub.endedAt || sub.cancelAt) * 1000).toLocaleDateString('sv-SE')}
                            </span>
                          )}
                          {sub.items?.map((item: any, i: number) => (
                            <span key={i}>Pris: {item.price ? `${(item.price / 100).toFixed(2)} kr` : '-'}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ticket.contextData.stripe.invoices && ticket.contextData.stripe.invoices.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-3">
                    Fakturor ({ticket.contextData.stripe.invoices.length})
                  </p>
                  <div className="space-y-2">
                    {ticket.contextData.stripe.invoices.map((inv: any, idx: number) => (
                      <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{inv.id}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            inv.paid
                              ? 'border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                              : 'border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                          }`}>
                            {inv.status || (inv.paid ? 'Betald' : 'Obetald')}
                          </span>
                        </div>
                        <div className="flex gap-4 text-xs text-slate-600 dark:text-slate-300">
                          <span>Belopp: {inv.amount ? `${(inv.amount / 100).toFixed(2)} kr` : '-'}</span>
                          {inv.dueDate && <span>Förfaller: {new Date(inv.dueDate * 1000).toLocaleDateString('sv-SE')}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ticket.contextData.stripe.charges && ticket.contextData.stripe.charges.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-3">
                    Betalningar ({ticket.contextData.stripe.charges.length})
                  </p>
                  <div className="space-y-2">
                    {ticket.contextData.stripe.charges.map((charge: any, idx: number) => (
                      <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{charge.id}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            charge.status === 'succeeded'
                              ? 'border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                              : 'border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                          }`}>
                            {charge.status}
                          </span>
                        </div>
                        <div className="flex gap-4 text-xs text-slate-600 dark:text-slate-300">
                          <span>Belopp: {charge.amount ? `${(charge.amount / 100).toFixed(2)} kr` : '-'}</span>
                          {charge.created && <span>Datum: {new Date(charge.created * 1000).toLocaleDateString('sv-SE')}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(!ticket.contextData.stripe.subscriptions?.length && !ticket.contextData.stripe.invoices?.length && !ticket.contextData.stripe.charges?.length) && (
                <div className="text-center py-12 text-slate-400 dark:text-slate-500">
                  <p className="text-sm">Ingen detaljerad Stripe-data tillgänglig</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resend Detail Modal */}
      {resendModalOpen && ticket.contextData?.resend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setResendModalOpen(false)}>
          <div
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-600 flex items-center justify-center">
                  <span className="text-white text-sm font-bold">R</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Resend</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">E-posthistorik</p>
                </div>
              </div>
              <button
                onClick={() => setResendModalOpen(false)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
                Totalt skickade: <span className="font-semibold">{ticket.contextData.resend.emailsSent || 0}</span> mail
              </p>
              {ticket.contextData.resend.recentEmails && ticket.contextData.resend.recentEmails.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-3">
                    Senaste mail ({ticket.contextData.resend.recentEmails.length})
                  </p>
                  <div className="space-y-2">
                    {ticket.contextData.resend.recentEmails.map((email: any, idx: number) => (
                      <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100 mb-1">
                          {email.subject || '(Inget ämne)'}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
                          {email.from && <span>Från: {email.from}</span>}
                          {email.to && <span>Till: {Array.isArray(email.to) ? email.to.join(', ') : email.to}</span>}
                          {email.createdAt && <span>Datum: {new Date(email.createdAt).toLocaleDateString('sv-SE')}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400 dark:text-slate-500">
                  <p className="text-sm">Inga mail hittades</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Retool Detail Modal */}
      {retoolModalOpen && ticket.contextData?.retool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRetoolModalOpen(false)}>
          <div
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-orange-600 flex items-center justify-center">
                  <span className="text-white text-sm font-bold">RT</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Retool</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Kunddata</p>
                </div>
              </div>
              <button
                onClick={() => setRetoolModalOpen(false)}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              {ticket.contextData.retool.data ? (
                <div className="space-y-3">
                  {typeof ticket.contextData.retool.data === 'object' ? (
                    Object.entries(ticket.contextData.retool.data).map(([key, value]: [string, any]) => (
                      <div key={key} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide mb-1">{key}</p>
                        <p className="text-sm text-slate-900 dark:text-slate-100">
                          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <pre className="text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                      {JSON.stringify(ticket.contextData.retool.data, null, 2)}
                    </pre>
                  )}
                </div>
              ) : (
                <pre className="text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                  {JSON.stringify(ticket.contextData.retool, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Previous Ticket Popout Modal */}
      {popoutLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-8 shadow-2xl flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-[#7C5CFF]" />
            <span className="text-sm text-slate-700 dark:text-slate-300">Laddar ärende...</span>
          </div>
        </div>
      )}
      {/* Image Lightbox Modal — replaces window.open which is blocked for data URIs */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Bildvisare"
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            aria-label="Stäng bildvisare"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxImage.src}
            alt={lightboxImage.alt}
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {lightboxImage.alt && (
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-black/60 text-white text-xs max-w-[90vw] truncate">
              {lightboxImage.alt}
            </p>
          )}
        </div>
      )}
      {popoutTicket && !popoutLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPopoutTicket(null)}>
          <div
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Popout Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">{popoutTicket.subject}</h2>
                <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1">
                  <span>{popoutTicket.customerEmail}</span>
                  <span>•</span>
                  <span>{new Date(popoutTicket.createdAt).toLocaleString('sv-SE')}</span>
                  <span>•</span>
                  <span className={`px-2 py-0.5 rounded-full font-medium ${
                    popoutTicket.status === 'closed' || popoutTicket.status === 'sent'
                      ? 'border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                      : popoutTicket.status === 'new'
                      ? 'border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                      : 'border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                  }`}>
                    {statusLabelSv(popoutTicket.status)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                {onSelectTicket && (
                  <button
                    onClick={() => {
                      onSelectTicket(popoutTicket);
                      setPopoutTicket(null);
                    }}
                    className="px-3 py-1.5 text-xs bg-[#7C5CFF] text-white rounded-md hover:bg-[#6B4FE0] transition-colors"
                  >
                    Öppna ärendet
                  </button>
                )}
                <button
                  onClick={() => setPopoutTicket(null)}
                  className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Popout Body */}
            <div className="flex-1 overflow-auto p-5 space-y-4">
              {/* Original Message */}
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-2">Kundens meddelande</p>
                <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 text-sm whitespace-pre-wrap text-slate-900 dark:text-slate-100 max-h-[300px] overflow-auto">
                  {popoutTicket.originalMessage?.replace(/\[Gmail ID:.*?\]\n?\[Inbox account:.*?\]\n?\n?/g, '').replace(/\n?\[DrabbadHanterad: [^\]]+\]/g, '').trim() || 'Inget meddelande'}
                </div>
              </div>

              {/* Attachments */}
              {popoutTicket.contextData?.attachments && popoutTicket.contextData.attachments.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-2">Bifogade filer</p>
                  <div className="flex flex-wrap gap-3">
                    {popoutTicket.contextData.attachments.map((att: any, idx: number) => {
                      const isImage = att.mimeType?.startsWith('image/') && att.dataUrl;
                      if (isImage) {
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setLightboxImage({ src: att.dataUrl, alt: att.filename })}
                            className="block focus:outline-none focus:ring-2 focus:ring-[#7C5CFF] rounded-lg"
                            aria-label={`Öppna bild ${att.filename}`}
                          >
                            <img
                              src={att.dataUrl}
                              alt={att.filename}
                              className="max-w-[180px] max-h-[180px] rounded-lg border border-slate-200 dark:border-slate-700 object-cover cursor-zoom-in hover:shadow-lg hover:border-[#7C5CFF]/40 transition-all"
                            />
                          </button>
                        );
                      }
                      return (
                        <a
                          key={idx}
                          href={att.dataUrl}
                          download={att.filename}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:border-[#7C5CFF]/40 transition-all max-w-[240px]"
                          title={`Ladda ner ${att.filename}`}
                        >
                          <FileText className="w-5 h-5 text-slate-400 flex-shrink-0" />
                          <span className="text-xs text-slate-700 dark:text-slate-300 truncate flex-1">{att.filename}</span>
                          <Download className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* AI Response */}
              {popoutTicket.aiResponse && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-2 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] flex items-center justify-center">
                      <span className="text-white text-[8px]">✨</span>
                    </span>
                    AI-förslag
                    {popoutTicket.aiConfidence && (
                      <span className="ml-1 px-1.5 py-0.5 bg-[#7C5CFF]/15 text-[#7C5CFF] dark:text-[#B8A6FF] rounded text-[10px] font-bold">
                        {Math.round(popoutTicket.aiConfidence * 100)}%
                      </span>
                    )}
                  </p>
                  <div className="bg-[#7C5CFF]/5 border border-[#7C5CFF]/20 rounded-lg p-4 text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-200 max-h-[250px] overflow-auto">
                    {popoutTicket.aiResponse}
                  </div>
                </div>
              )}

              {/* Sent Response */}
              {popoutTicket.finalResponse && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-2">Skickat svar</p>
                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4 text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-200 max-h-[250px] overflow-auto">
                    {popoutTicket.finalResponse}
                  </div>
                  {popoutTicket.sentAt && (
                    <p className="text-[10px] text-slate-400 mt-1">Skickat: {new Date(popoutTicket.sentAt).toLocaleString('sv-SE')}</p>
                  )}
                </div>
              )}

              {/* Context summary */}
              {popoutTicket.contextData && (
                <div className="flex flex-wrap gap-2">
                  {popoutTicket.contextData.stripe && (
                    <span className="text-[10px] px-2 py-1 rounded bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">
                      Stripe: {popoutTicket.contextData.stripe.subscriptions?.length || 0} pren.
                    </span>
                  )}
                  {popoutTicket.contextData.billecta && (
                    <span className="text-[10px] px-2 py-1 rounded bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300">
                      Billecta: {popoutTicket.contextData.billecta.invoices?.length || 0} fakturor
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
