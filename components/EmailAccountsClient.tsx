'use client';

import { useState } from 'react';
import { Plus, Mail, Trash2, RefreshCw } from 'lucide-react';

interface EmailAccount {
  id: string;
  email: string;
  provider: string;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
}

interface EmailAccountsClientProps {
  initialAccounts: EmailAccount[];
}

export default function EmailAccountsClient({ initialAccounts }: EmailAccountsClientProps) {
  const [accounts, setAccounts] = useState<EmailAccount[]>(initialAccounts);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const handleAddAccount = () => {
    window.location.href = '/api/auth/gmail/authorize';
  };

  const handleSyncAllAccounts = async () => {
    setSyncingAll(true);
    try {
      const response = await fetch('/api/email-accounts/sync-all', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Synkronisering klar! ${data.totalNewTickets || 0} nya tickets från ${data.syncedAccounts || 0} konton.`);
        window.location.reload();
      }
    } catch (error) {
      console.error('Error syncing all accounts:', error);
    } finally {
      setSyncingAll(false);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    if (!confirm('Är du säker på att du vill ta bort detta e-postkonto?')) {
      return;
    }

    try {
      const response = await fetch(`/api/email-accounts/${accountId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setAccounts(accounts.filter(a => a.id !== accountId));
      }
    } catch (error) {
      console.error('Error removing account:', error);
    }
  };

  const handleSyncAccount = async (accountId: string) => {
    setSyncing(accountId);
    try {
      const response = await fetch(`/api/email-accounts/${accountId}/sync`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Synkronisering klar! ${data.newTickets} nya tickets skapade.`);
        window.location.reload();
      }
    } catch (error) {
      console.error('Error syncing account:', error);
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="p-6 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Anslutna konton
          </h2>
          <div className="flex items-center gap-2">
            {accounts.length > 0 && (
              <button
                onClick={handleSyncAllAccounts}
                disabled={syncingAll}
                className="flex items-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${syncingAll ? 'animate-spin' : ''}`} />
                {syncingAll ? 'Synkar...' : 'Synka alla'}
              </button>
            )}
            <button
              onClick={handleAddAccount}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-lg hover:brightness-110 transition-all shadow-[0_0_15px_rgba(124,92,255,0.4)]"
            >
              <Plus className="w-4 h-4" />
              Lägg till konto
            </button>
          </div>
        </div>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-700">
        {accounts.length === 0 ? (
          <div className="p-12 text-center">
            <Mail className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
            <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">
              Inga e-postkonton anslutna
            </h3>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              Lägg till ett Gmail-konto för att börja ta emot kundärenden
            </p>
            <button
              onClick={handleAddAccount}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white rounded-lg hover:brightness-110 transition-all shadow-[0_0_15px_rgba(124,92,255,0.4)]"
            >
              <Plus className="w-5 h-5" />
              Lägg till ditt första konto
            </button>
          </div>
        ) : (
          accounts.map((account) => (
            <div key={account.id} className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-center">
                    <Mail className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">
                      {account.email}
                    </h3>
                    {account.ownerName && (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Kopplat av {account.ownerName}{account.ownerEmail ? ` (${account.ownerEmail})` : ''}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        account.isActive
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300'
                      }`}>
                        {account.isActive ? 'Aktiv' : 'Inaktiv'}
                      </span>
                      {account.lastSyncAt && (
                        <span className="text-xs text-slate-500 dark:text-slate-400" suppressHydrationWarning>
                          Senast synkad: {new Date(account.lastSyncAt).toLocaleString('sv-SE')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSyncAccount(account.id)}
                    disabled={syncing === account.id}
                    className="p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                    title="Synkronisera nu"
                  >
                    <RefreshCw className={`w-5 h-5 ${syncing === account.id ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => handleRemoveAccount(account.id)}
                    className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    title="Ta bort konto"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
