'use client';

import { useEffect, useState } from 'react';
import { Users, Trash2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { t } from '@/lib/i18n';

interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  createdAt: string;
  connectedInboxes: number;
  isSettingsAdmin: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  agent: 'Agent',
  admin: 'Admin',
  superadmin: 'Superadmin',
};

export default function UsersAdmin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      if (!res.ok) {
        setError(`${t('Kunde inte hämta användare')} (${res.status})`);
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
      setCurrentUserEmail((data.currentUserEmail || '').toLowerCase());
      setError(null);
    } catch {
      setError(t('Nätverksfel vid hämtning av användare'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const changeRole = async (user: AdminUser, role: string) => {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || `${t('Kunde inte ändra roll')} (${res.status})`);
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role } : u)));
    } finally {
      setBusyId(null);
    }
  };

  const removeUser = async (user: AdminUser) => {
    const warning = user.connectedInboxes > 0
      ? `\n\n${t('OBS: Den här användaren har')} ${user.connectedInboxes} ${t('kopplad(e) inkorg(ar). Att ta bort kontot stoppar synkningen av dessa inkorgar.')}`
      : '';
    if (!confirm(`${t('Ta bort')} ${user.email}?${warning}`)) return;
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || `${t('Kunde inte ta bort användaren')} (${res.status})`);
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">{t('Användare')}</h2>
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-indigo-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-medium text-slate-900 dark:text-slate-100">{t('Hantera teamet')}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                {t('Ändra roll eller ta bort konton. Admin-rollen ger åtkomst till Settings. Superadmin styrs via deploy-inställningar och kan inte ändras här.')}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('Laddar…')}</div>
        ) : users.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('Inga användare ännu.')}</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {users.map((u) => {
              const isSelf = u.email.toLowerCase() === currentUserEmail;
              const isSuperadmin = u.role === 'superadmin' || (u.isSettingsAdmin && u.role !== 'admin');
              const lockedRole = u.isSettingsAdmin && u.role !== 'admin';
              return (
                <div key={u.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {u.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.image} alt={u.name || u.email} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                          {(u.name || u.email).charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                        {u.name || u.email}
                        {isSelf && <span className="ml-2 text-xs text-slate-400">({t('du')})</span>}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{u.email}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {u.isSettingsAdmin && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck className="w-3 h-3" /> {t('Settings-åtkomst')}
                          </span>
                        )}
                        {u.connectedInboxes > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="w-3 h-3" /> {u.connectedInboxes} {t('inkorg(ar)')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {lockedRole ? (
                      <span className="text-xs px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    ) : (
                      <select
                        value={u.role === 'superadmin' ? 'admin' : u.role}
                        disabled={busyId === u.id || isSuperadmin}
                        onChange={(e) => changeRole(u, e.target.value)}
                        className="text-xs px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                      >
                        <option value="agent">{ROLE_LABELS.agent}</option>
                        <option value="admin">{ROLE_LABELS.admin}</option>
                      </select>
                    )}
                    <button
                      onClick={() => removeUser(u)}
                      disabled={busyId === u.id || isSelf || u.isSettingsAdmin}
                      title={isSelf ? t('Du kan inte ta bort dig själv') : u.isSettingsAdmin ? t('Superadmin kan inte tas bort här') : t('Ta bort användare')}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
