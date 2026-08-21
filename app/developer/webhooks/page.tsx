'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import { WEBHOOK_EVENTS, SUBSCRIBABLE_EVENT_TYPES } from '@/lib/webhooks/events';

interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  isActive: boolean;
  lastDeliveryAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  autoDisabledAt: string | null;
  createdAt: string;
}

interface Delivery {
  id: string;
  event: string;
  status: string;
  statusCode: number | null;
  attempts: number;
  error: string | null;
  durationMs: number | null;
  payload: unknown;
  createdAt: string;
}

const SUBSCRIBABLE = WEBHOOK_EVENTS.filter((e) => SUBSCRIBABLE_EVENT_TYPES.includes(e.type));

const CARD =
  'bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700';
const INPUT =
  'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100';
const PRIMARY =
  'px-4 py-2 bg-[#7C5CFF] text-white rounded-md hover:bg-[#6B4FE8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const SECONDARY =
  'px-3 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50';

function relative(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Shown once, right after creation or rotation — we only store the hash-
  // equivalent (encrypted) form and never hand the secret back again.
  const [freshSecret, setFreshSecret] = useState<{ id: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/webhooks');
      if (!response.ok) throw new Error('Could not load webhooks');
      const data = await response.json();
      setWebhooks(data.webhooks);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Could not load webhooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, description, events }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create webhook');
      setFreshSecret({ id: data.webhook.id, secret: data.webhook.secret });
      setUrl('');
      setDescription('');
      setEvents([]);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const response = await fetch(`/api/webhooks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update webhook');
      if (data.webhook?.secret) setFreshSecret({ id, secret: data.webhook.secret });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this endpoint? Events will stop being delivered to it immediately.')) return;
    await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
    await load();
  };

  const sendTest = async (id: string) => {
    setTesting(id);
    setTestResult((prev) => ({ ...prev, [id]: '' }));
    try {
      const response = await fetch(`/api/webhooks/${id}/test`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Test failed');
      const result = data.result;
      setTestResult((prev) => ({
        ...prev,
        [id]: result.ok
          ? `✓ Delivered — HTTP ${result.statusCode} in ${result.durationMs} ms`
          : `✗ Failed after ${result.attempts} attempt(s): ${result.error}`,
      }));
      if (expanded === id) await loadDeliveries(id);
      await load();
    } catch (err: any) {
      setTestResult((prev) => ({ ...prev, [id]: `✗ ${err.message}` }));
    } finally {
      setTesting(null);
    }
  };

  const loadDeliveries = async (id: string) => {
    const response = await fetch(`/api/webhooks/${id}/deliveries`);
    if (!response.ok) return;
    const data = await response.json();
    setDeliveries((prev) => ({ ...prev, [id]: data.deliveries }));
  };

  const toggleExpanded = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    await loadDeliveries(id);
  };

  const copySecret = (secret: string) => {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Webhooks</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
            Get ticket events pushed to your own systems instead of polling the API. Every
            delivery is signed — see{' '}
            <a href="/developer/docs#webhooks" className="text-[#7C5CFF] hover:underline">
              the webhook guide
            </a>{' '}
            for the payload format and how to verify the signature.
          </p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className={`${PRIMARY} flex items-center gap-2 shrink-0`}>
          <Plus className="w-4 h-4" />
          Add endpoint
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {freshSecret && (
        <div className="rounded-lg border border-green-300 dark:border-green-800 p-4 space-y-2">
          <p className="text-sm text-green-800 dark:text-green-200">
            ✓ Signing secret for this endpoint. Copy it now — it is never shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm bg-slate-100 dark:bg-slate-900 px-3 py-2 rounded font-mono text-slate-900 dark:text-slate-100 break-all">
              {freshSecret.secret}
            </code>
            <button onClick={() => copySecret(freshSecret.secret)} className="p-2 rounded hover:bg-green-100 dark:hover:bg-green-800">
              {copied ? <CheckCircle className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5 text-green-600" />}
            </button>
            <button onClick={() => setFreshSecret(null)} className={SECONDARY}>
              Done
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className={`${CARD} p-6 space-y-4`}>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Endpoint URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/hooks/support"
              className={INPUT}
              autoFocus
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Must be https and publicly reachable. Answer with any 2xx within 10 seconds.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Description <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. CRM sync (production)"
              className={INPUT}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Events</label>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Select none to receive every event, including ones we add later.
            </p>
            <div className="space-y-2">
              {SUBSCRIBABLE.map((event) => (
                <label key={event.type} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={events.includes(event.type)}
                    onChange={(e) =>
                      setEvents((prev) =>
                        e.target.checked ? [...prev, event.type] : prev.filter((t) => t !== event.type),
                      )
                    }
                  />
                  <span>
                    <code className="font-mono text-slate-900 dark:text-slate-100">{event.type}</code>
                    <span className="text-slate-600 dark:text-slate-400"> — {event.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className={`${SECONDARY} px-4 py-2`}>
              Cancel
            </button>
            <button onClick={create} disabled={!url.trim() || saving} className={PRIMARY}>
              {saving ? 'Creating…' : 'Create endpoint'}
            </button>
          </div>
        </div>
      )}

      <div className={CARD}>
        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Registered endpoints</h2>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-700">
          {webhooks.length === 0 ? (
            <div className="p-8 text-center text-slate-600 dark:text-slate-400">
              No endpoints yet. Add one to start receiving ticket events.
            </div>
          ) : (
            webhooks.map((hook) => (
              <div key={hook.id} className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <Webhook className="w-5 h-5 text-slate-400 shrink-0" />
                      <code className="font-mono text-sm text-slate-900 dark:text-slate-100 break-all">{hook.url}</code>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          hook.isActive
                            ? 'border border-green-300 text-green-700 dark:border-green-700 dark:text-green-300'
                            : 'border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {hook.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </div>

                    {hook.description && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{hook.description}</p>
                    )}

                    <div className="flex flex-wrap gap-1 mb-2">
                      {(hook.events.length ? hook.events : ['all events']).map((event) => (
                        <code
                          key={event}
                          className="text-xs bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300"
                        >
                          {event}
                        </code>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
                      <span>Created {new Date(hook.createdAt).toLocaleDateString()}</span>
                      <span>Last delivery {relative(hook.lastDeliveryAt)}</span>
                      {hook.lastStatusCode !== null && <span>Last status {hook.lastStatusCode}</span>}
                    </div>

                    {hook.autoDisabledAt && (
                      <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          Disabled automatically after {hook.consecutiveFailures} failed deliveries in a row
                          {hook.lastError ? `: ${hook.lastError}` : ''}. Fix your receiver, then re-enable.
                        </span>
                      </div>
                    )}
                    {!hook.autoDisabledAt && hook.lastError && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">Last error: {hook.lastError}</p>
                    )}

                    {testResult[hook.id] && (
                      <p className="mt-2 text-xs text-slate-700 dark:text-slate-300">{testResult[hook.id]}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => sendTest(hook.id)} disabled={testing === hook.id} className={`${SECONDARY} flex items-center gap-1`}>
                      <Send className="w-3.5 h-3.5" />
                      {testing === hook.id ? 'Sending…' : 'Send test'}
                    </button>
                    <button
                      onClick={() => patch(hook.id, { rotateSecret: true })}
                      className={`${SECONDARY} flex items-center gap-1`}
                      title="Generate a new signing secret"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Rotate secret
                    </button>
                    <button onClick={() => patch(hook.id, { isActive: !hook.isActive })} className={SECONDARY}>
                      {hook.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => remove(hook.id)}
                      className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => toggleExpanded(hook.id)}
                  className="mt-3 flex items-center gap-1 text-sm text-[#7C5CFF] hover:underline"
                >
                  {expanded === hook.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  Recent deliveries
                </button>

                {expanded === hook.id && (
                  <div className="mt-3 rounded border border-slate-200 dark:border-slate-700 overflow-x-auto">
                    {(deliveries[hook.id]?.length ?? 0) === 0 ? (
                      <p className="p-4 text-sm text-slate-600 dark:text-slate-400">
                        Nothing delivered yet. Press <strong>Send test</strong> to check your receiver.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900/50 text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                          <tr>
                            <th className="px-3 py-2">When</th>
                            <th className="px-3 py-2">Event</th>
                            <th className="px-3 py-2">Result</th>
                            <th className="px-3 py-2">Attempts</th>
                            <th className="px-3 py-2">Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                          {deliveries[hook.id].map((delivery) => (
                            <tr key={delivery.id} className="text-slate-700 dark:text-slate-300">
                              <td className="px-3 py-2 whitespace-nowrap">{new Date(delivery.createdAt).toLocaleString()}</td>
                              <td className="px-3 py-2 font-mono text-xs">{delivery.event}</td>
                              <td className="px-3 py-2">
                                {delivery.status === 'success' ? (
                                  <span className="text-green-700 dark:text-green-300">HTTP {delivery.statusCode}</span>
                                ) : (
                                  <span className="text-red-600 dark:text-red-400">
                                    {delivery.statusCode ? `HTTP ${delivery.statusCode}` : 'No response'}
                                    {delivery.error ? ` — ${delivery.error}` : ''}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">{delivery.attempts}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{delivery.durationMs ?? '–'} ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
