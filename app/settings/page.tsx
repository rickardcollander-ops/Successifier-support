'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, ExternalLink, RefreshCw, CheckCircle, AlertCircle, Ban, X, AlertTriangle, Trash2 } from 'lucide-react';
import IntegrationCard from '@/components/IntegrationCard';
import type { Integration } from '@/lib/types';

interface BlockedSender {
  id: string;
  pattern: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface AffectedTicket {
  id: string;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  status: string;
  sentAt: string | null;
  repliesAfterOriginal: number;
  lastFollowupAt: string | null;
}
interface AffectedReport {
  count: number;
  uniqueCustomerCount: number;
  totalUnseenReplies: number;
  customerEmails: string[];
  tickets: AffectedTicket[];
}

interface ConnectedEmailAccount {
  id: string;
  email: string;
  provider: string;
  isActive: boolean;
  lastSyncAt: string | null;
  user?: { name: string | null; email: string | null };
}

export default function SettingsPage() {
  const router = useRouter();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<ConnectedEmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [blockedSenders, setBlockedSenders] = useState<BlockedSender[]>([]);
  const [blockedInput, setBlockedInput] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [blockedSubmitting, setBlockedSubmitting] = useState(false);
  const [affectedReport, setAffectedReport] = useState<AffectedReport | null>(null);
  const [affectedLoading, setAffectedLoading] = useState(false);
  const [affectedError, setAffectedError] = useState<string | null>(null);
  const [affectedDeleting, setAffectedDeleting] = useState<string | null>(null);

  const openAffectedTicket = (ticketId: string) => {
    // Land on the tickets page with the deep-link query param so the
    // tickets view auto-selects this ticket on mount (see page.tsx).
    router.push(`/tickets?ticket=${encodeURIComponent(ticketId)}`);
  };

  const deleteAffectedTicket = async (ticketId: string) => {
    if (affectedDeleting) return;
    if (!confirm('Ta bort detta ärende? Detta kan inte ångras.')) return;
    setAffectedDeleting(ticketId);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/delete`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Kunde inte radera: ${data?.error || res.status}`);
        return;
      }
      // Remove the row from the local report and recompute the summary
      // counts so the header numbers stay in sync.
      setAffectedReport((prev) => {
        if (!prev) return prev;
        const remaining = prev.tickets.filter((t) => t.id !== ticketId);
        const remainingEmails = Array.from(
          new Set(remaining.map((t) => t.customerEmail.toLowerCase()))
        ).sort();
        return {
          ...prev,
          tickets: remaining,
          count: remaining.length,
          uniqueCustomerCount: remainingEmails.length,
          customerEmails: remainingEmails,
          totalUnseenReplies: remaining.reduce((s, t) => s + t.repliesAfterOriginal, 0),
        };
      });
    } catch (e) {
      alert('Nätverksfel vid radering');
    } finally {
      setAffectedDeleting(null);
    }
  };

  useEffect(() => {
    fetchIntegrations();
    fetchEmailAccounts();
    fetchBlockedSenders();
  }, []);

  const fetchAffectedReport = async () => {
    setAffectedLoading(true);
    setAffectedError(null);
    try {
      const res = await fetch('/api/admin/affected-by-closed-reply-bug');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAffectedError(data?.error || `Fel: ${res.status}`);
        return;
      }
      const data = await res.json();
      setAffectedReport(data);
    } catch (e: any) {
      setAffectedError(e?.message || 'Nätverksfel');
    } finally {
      setAffectedLoading(false);
    }
  };

  const downloadAffectedCsv = () => {
    if (!affectedReport) return;
    const rows = [
      ['customerEmail', 'customerName', 'subject', 'status', 'repliesAfterOriginal', 'lastFollowupAt', 'ticketId'],
      ...affectedReport.tickets.map((t) => [
        t.customerEmail,
        t.customerName ?? '',
        t.subject.replace(/"/g, '""'),
        t.status,
        String(t.repliesAfterOriginal),
        t.lastFollowupAt ?? '',
        t.id,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drabbade-kundsvar-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fetchBlockedSenders = async () => {
    try {
      const res = await fetch('/api/blocked-senders');
      if (res.ok) {
        const data = await res.json();
        setBlockedSenders(data.blockedSenders || []);
      }
    } catch (error) {
      console.error('Error fetching blocked senders:', error);
    }
  };

  const addBlockedSender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockedInput.trim()) return;
    setBlockedSubmitting(true);
    setBlockedError(null);
    try {
      const res = await fetch('/api/blocked-senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pattern: blockedInput.trim(),
          reason: blockedReason.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBlockedError(data.error || `Fel: ${res.status}`);
        return;
      }
      setBlockedInput('');
      setBlockedReason('');
      await fetchBlockedSenders();
    } catch (error) {
      setBlockedError('Nätverksfel');
    } finally {
      setBlockedSubmitting(false);
    }
  };

  const removeBlockedSender = async (id: string) => {
    if (!confirm('Ta bort denna blockering?')) return;
    try {
      await fetch(`/api/blocked-senders?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await fetchBlockedSenders();
    } catch (error) {
      console.error('Error removing blocked sender:', error);
    }
  };

  const fetchEmailAccounts = async () => {
    try {
      const response = await fetch('/api/email-accounts');
      if (response.ok) {
        const data = await response.json();
        setEmailAccounts(data.accounts || data || []);
      }
    } catch (error) {
      console.error('Error fetching email accounts:', error);
    }
  };

  const fetchIntegrations = async () => {
    try {
      const response = await fetch('/api/integrations');
      if (response.ok) {
        const data = await response.json();
        setIntegrations(data.integrations);
      }
    } catch (error) {
      console.error('Error fetching integrations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async (integration: Integration) => {
    try {
      const response = await fetch(`/api/integrations/${integration.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          ok: false,
          message: data?.message || data?.error || `HTTP ${response.status}`,
        };
      }

      return {
        ok: Boolean(data?.ok),
        message: data?.message || (data?.ok ? 'Connection OK' : 'Connection failed'),
      };
    } catch (error) {
      console.error('Error testing integration:', error);
      return { ok: false, message: 'Network error while testing connection' };
    }
  };

  const handleSave = async (type: string, credentials: Record<string, string>) => {
    try {
      const normalizedCredentials = Object.fromEntries(
        Object.entries(credentials).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
      );

      if (type === 'billecta') {
        const apiKey = String(normalizedCredentials.apiKey || '');
        const creditorPublicId = String(normalizedCredentials.creditorPublicId || '');
        if (!apiKey || !creditorPublicId) {
          return {
            ok: false,
            message: 'Billecta requires both API key and Creditor Public ID',
          };
        }
      }

      const existing = integrations.find(i => i.type === type);
      const url = existing ? `/api/integrations/${existing.id}` : '/api/integrations';
      const method = existing ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, credentials: normalizedCredentials }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const savedIntegration = data;
        if (existing) {
          setIntegrations((prev) => prev.map(i => i.id === savedIntegration.id ? savedIntegration : i));
        } else {
          setIntegrations((prev) => [...prev, savedIntegration]);
        }

        return { ok: true };
      }

      return {
        ok: false,
        message: data?.error || data?.message || `Failed to save integration (${response.status})`,
      };
    } catch (error) {
      console.error('Error saving integration:', error);

      return {
        ok: false,
        message: 'Network error while saving integration',
      };
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      const response = await fetch(`/api/integrations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });

      if (response.ok) {
        const updatedIntegration = await response.json();
        setIntegrations(integrations.map(i => i.id === id ? updatedIntegration : i));
      }
    } catch (error) {
      console.error('Error toggling integration:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Loading settings...</div>
      </div>
    );
  }

  const getIntegration = (type: string) => integrations.find(i => i.type === type);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2 text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="text-slate-600 dark:text-slate-400">Configure your integrations to enable AI-powered context gathering</p>
      </div>

      {/* Connected Gmail Accounts Section */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">E-postkonton (Gmail)</h2>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                <Mail className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-medium text-slate-900 dark:text-slate-100">Kopplade Gmail-konton</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                  Dessa konton bevakas aktivt. Nya inkommande mail skapas automatiskt som tickets i inkorgen.
                </p>
              </div>
            </div>
          </div>

          {emailAccounts.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-3">Inga Gmail-konton kopplade ännu.</p>
              <a
                href="/settings/email-accounts"
                className="inline-flex items-center gap-2 text-sm font-medium text-[#7C5CFF] hover:text-[#9F7BFF] transition-colors"
              >
                Lägg till konto <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {emailAccounts.map((account) => (
                <div key={account.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full border border-blue-300 dark:border-blue-700 flex items-center justify-center">
                      <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100 text-sm">{account.email}</p>
                      {account.user?.name && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Kopplat av {account.user.name}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        {account.isActive ? (
                          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <CheckCircle className="w-3 h-3" /> Aktiv — synkas till inkorgen
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <AlertCircle className="w-3 h-3" /> Inaktiv
                          </span>
                        )}
                        {account.lastSyncAt && (
                          <span className="text-xs text-slate-400" suppressHydrationWarning>
                            · Senast synkad {new Date(account.lastSyncAt).toLocaleString('sv-SE')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                <strong>Vad styr detta?</strong> Varje kopplat konto bevakas för nya mail. När ett mail kommer in skapas det som ett ärende i tickets-vyn med AI-genererat svar.
              </div>
              <a
                href="/settings/email-accounts"
                className="flex items-center gap-1.5 text-sm font-medium text-[#7C5CFF] hover:text-[#9F7BFF] transition-colors whitespace-nowrap ml-4"
              >
                Hantera <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Affected by closed-reply bug (diagnostic) */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Drabbade kunder (stängd-ärende-buggen)</h2>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-slate-900 dark:text-slate-100">Hitta kunder vars svar hamnade i Stängda</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                  Listar stängda/skickade ärenden där en kund replierat efteråt. Dessa ärenden bör eventuellt öppnas igen och besvaras.
                </p>
              </div>
              <button
                onClick={fetchAffectedReport}
                disabled={affectedLoading}
                className="text-sm px-4 py-2 rounded-md bg-[#7C5CFF] text-white hover:bg-[#6B4FE0] disabled:opacity-50 whitespace-nowrap"
              >
                {affectedLoading ? 'Söker…' : affectedReport ? 'Sök om' : 'Visa drabbade'}
              </button>
            </div>
          </div>
          {affectedError && (
            <div className="px-4 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
              {affectedError}
            </div>
          )}
          {affectedReport && (
            <>
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-slate-700 dark:text-slate-300">
                  <strong>{affectedReport.count}</strong> ärenden ·{' '}
                  <strong>{affectedReport.uniqueCustomerCount}</strong> unika kunder ·{' '}
                  <strong>{affectedReport.totalUnseenReplies}</strong> följdmail totalt
                </div>
                <button
                  onClick={downloadAffectedCsv}
                  className="text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  Ladda ner CSV
                </button>
              </div>
              {affectedReport.customerEmails.length > 0 && (
                <div className="p-5 border-b border-slate-100 dark:border-slate-700">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-2">
                    Unika e-postadresser ({affectedReport.customerEmails.length})
                  </p>
                  <textarea
                    readOnly
                    value={affectedReport.customerEmails.join('\n')}
                    rows={Math.min(10, affectedReport.customerEmails.length)}
                    className="w-full font-mono text-xs px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-md bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  />
                </div>
              )}
              {affectedReport.tickets.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  Inga drabbade ärenden hittades.
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 sticky top-0">
                      <tr className="text-left text-slate-500 dark:text-slate-400">
                        <th className="px-4 py-2 font-medium">Kund</th>
                        <th className="px-4 py-2 font-medium">Ämne</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                        <th className="px-4 py-2 font-medium text-right">Följdmail</th>
                        <th className="px-4 py-2 font-medium">Senaste</th>
                        <th className="px-2 py-2 font-medium w-10" aria-label="Åtgärder" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {affectedReport.tickets.map((t) => (
                        <tr
                          key={t.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-700/40"
                        >
                          <td className="px-4 py-2 font-mono text-slate-900 dark:text-slate-100 whitespace-nowrap">{t.customerEmail}</td>
                          <td className="px-4 py-2 text-slate-700 dark:text-slate-300 max-w-xs truncate" title={t.subject}>{t.subject}</td>
                          <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{t.status}</td>
                          <td className="px-4 py-2 text-right text-slate-900 dark:text-slate-100 font-semibold">{t.repliesAfterOriginal}</td>
                          <td className="px-4 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{t.lastFollowupAt ?? '—'}</td>
                          <td className="px-2 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => openAffectedTicket(t.id)}
                                className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-500 dark:hover:text-blue-400 dark:hover:bg-blue-900/20 transition-colors"
                                title="Öppna ärende"
                                aria-label="Öppna ärende"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteAffectedTicket(t.id);
                                }}
                                disabled={affectedDeleting === t.id}
                                className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:text-slate-500 dark:hover:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                                title="Ta bort ärende"
                                aria-label="Ta bort ärende"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Blocked senders */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Blockerade avsändare</h2>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-red-500 to-red-600 flex items-center justify-center flex-shrink-0">
                <Ban className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-medium text-slate-900 dark:text-slate-100">Filtrera bort avsändare</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                  Mejl från dessa adresser markeras automatiskt som lästa i Gmail och skapar inga ärenden. Ange en hel e-postadress (t.ex. <code>spam@exempel.se</code>) eller en hel domän med inledande @ (t.ex. <code>@spamdomän.se</code>).
                </p>
              </div>
            </div>
          </div>
          <form onSubmit={addBlockedSender} className="p-4 border-b border-slate-100 dark:border-slate-700 flex flex-col gap-2 sm:flex-row sm:items-start">
            <input
              type="text"
              value={blockedInput}
              onChange={(e) => setBlockedInput(e.target.value)}
              placeholder="email@exempel.se eller @exempel.se"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              required
            />
            <input
              type="text"
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value)}
              placeholder="Anledning (valfritt)"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={blockedSubmitting || !blockedInput.trim()}
              className="px-4 py-2 text-sm font-medium rounded-md bg-[#7C5CFF] text-white hover:bg-[#6B4FE0] disabled:opacity-50 whitespace-nowrap"
            >
              {blockedSubmitting ? 'Lägger till…' : 'Blockera'}
            </button>
          </form>
          {blockedError && (
            <div className="px-4 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
              {blockedError}
            </div>
          )}
          {blockedSenders.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Inga blockerade avsändare ännu.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {blockedSenders.map((bs) => (
                <div key={bs.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-slate-900 dark:text-slate-100 truncate">{bs.pattern}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {bs.reason ? `${bs.reason} · ` : ''}
                      Tillagd {new Date(bs.createdAt).toLocaleDateString('sv-SE')}
                      {bs.createdBy ? ` av ${bs.createdBy}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => removeBlockedSender(bs.id)}
                    className="text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-colors flex-shrink-0"
                    title="Ta bort blockering"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Integrationer</h2>
      <div className="space-y-6">
        <IntegrationCard
          type="stripe"
          name="Stripe"
          description="Access customer payment history, subscriptions, and invoices"
          integration={getIntegration('stripe')}
          fields={[
            { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk_live_...' },
          ]}
          onSave={handleSave}
          onToggle={handleToggle}
          onTestConnection={handleTestConnection}
        />

        <IntegrationCard
          type="billecta"
          name="Billecta"
          description="Retrieve invoice and billing information"
          integration={getIntegration('billecta')}
          fields={[
            { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Your Billecta API key' },
            { key: 'creditorPublicId', label: 'Creditor Public ID', type: 'text', placeholder: 'Your creditor ID' },
          ]}
          onSave={handleSave}
          onToggle={handleToggle}
          onTestConnection={handleTestConnection}
        />

        <IntegrationCard
          type="retool"
          name="Retool"
          description="Connect to your Retool workflows and data"
          integration={getIntegration('retool')}
          fields={[
            { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Your Retool API key' },
            { key: 'workspaceUrl', label: 'Workspace URL', type: 'text', placeholder: 'https://yourcompany.retool.com' },
          ]}
          onSave={handleSave}
          onToggle={handleToggle}
          onTestConnection={handleTestConnection}
        />

        <IntegrationCard
          type="resend"
          name="Resend"
          description="Send email responses and view email history"
          integration={getIntegration('resend')}
          fields={[
            { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 're_...' },
            { key: 'fromEmail', label: 'From Email', type: 'email', placeholder: 'support@yourcompany.com' },
          ]}
          onSave={handleSave}
          onToggle={handleToggle}
          onTestConnection={handleTestConnection}
        />

        <IntegrationCard
          type="gmail"
          name="Gmail"
          description="Convert inbox emails to tickets and view email history"
          integration={getIntegration('gmail')}
          fields={[
            { key: 'clientId', label: 'OAuth Client ID', type: 'text', placeholder: 'Your Google OAuth Client ID' },
            { key: 'clientSecret', label: 'OAuth Client Secret', type: 'password', placeholder: 'Your Google OAuth Client Secret' },
            { key: 'refreshToken', label: 'Refresh Token', type: 'password', placeholder: 'Your OAuth Refresh Token' },
          ]}
          onSave={handleSave}
          onToggle={handleToggle}
          onTestConnection={handleTestConnection}
        />

        <IntegrationCard
          type="postman"
          name="Postman"
          description="Connect to Postman API for API testing and monitoring"
          integration={getIntegration('postman')}
          fields={[
            { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'PMAK-...' },
            { key: 'workspaceId', label: 'Workspace ID', type: 'text', placeholder: 'Your Postman Workspace ID' },
          ]}
          onSave={handleSave}
          onToggle={handleToggle}
          onTestConnection={handleTestConnection}
        />
      </div>
    </div>
  );
}
