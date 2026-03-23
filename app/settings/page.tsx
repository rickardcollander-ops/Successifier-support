'use client';

import { useState, useEffect } from 'react';
import { Mail, ExternalLink, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import IntegrationCard from '@/components/IntegrationCard';
import type { Integration } from '@/lib/types';

interface ConnectedEmailAccount {
  id: string;
  email: string;
  provider: string;
  isActive: boolean;
  lastSyncAt: string | null;
  user?: { name: string | null; email: string | null };
}

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<ConnectedEmailAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchIntegrations();
    fetchEmailAccounts();
  }, []);

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
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
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
