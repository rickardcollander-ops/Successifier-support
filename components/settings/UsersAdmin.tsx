'use client';

import { useEffect, useState } from 'react';
import { Users, Trash2, ShieldCheck, AlertTriangle, UserPlus, Ban, RotateCcw, Clock } from 'lucide-react';
import { t } from '@/lib/i18n';

interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  status: string;
  invitedAt: string | null;
  invitedByEmail: string | null;
  lastLoginAt: string | null;
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
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('agent');
  const [inviting, setInviting] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

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

  const changeStatus = async (user: AdminUser, status: string) => {
    if (
      status === 'disabled' &&
      !confirm(
        `${t('Stäng av')} ${user.email}?\n\n${t('Kontot behålls med sin ärendehistorik men kommer inte in. Aktiva sessioner slutar gälla inom några minuter.')}`,
      )
    ) {
      return;
    }
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || `${t('Kunde inte ändra status')} (${res.status})`);
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status } : u)));
    } finally {
      setBusyId(null);
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    setInviteNotice(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteNotice({ kind: 'error', text: data.error || `${t('Kunde inte bjuda in')} (${res.status})` });
        return;
      }
      setInviteEmail('');
      // The grant and the mail are separate outcomes — say which one happened
      // so an admin knows whether to pass the sign-in link along by hand.
      setInviteNotice(
        data.emailError
          ? { kind: 'error', text: data.emailError }
          : {
              kind: 'ok',
              text: data.emailed
                ? `${email} ${t('är inbjuden och har fått ett mejl.')}`
                : `${email} ${t('är inbjuden.')}`,
            },
      );
      load();
    } catch {
      setInviteNotice({ kind: 'error', text: t('Nätverksfel vid inbjudan') });
    } finally {
      setInviting(false);
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
                {t('Bjud in kollegor, ändra roll, stäng av eller ta bort konton. Admin-rollen ger åtkomst till Settings och Developer-portalen. Agenter ser bara inkorgen. Superadmin styrs via deploy-inställningar och visas inte här.')}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={invite} className="p-4 border-b border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder={t('kollega@företaget.se')}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
          >
            <option value="agent">{ROLE_LABELS.agent}</option>
            <option value="admin">{ROLE_LABELS.admin}</option>
          </select>
          <button
            type="submit"
            disabled={inviting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            {inviting ? t('Bjuder in…') : t('Bjud in')}
          </button>
        </form>

        {inviteNotice && (
          <div
            className={`px-4 py-2 text-xs border-b ${
              inviteNotice.kind === 'ok'
                ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}
          >
            {inviteNotice.text}
          </div>
        )}

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
              // Platform superadmins are filtered out server-side, so every
              // listed account (incl. product admins like Ida) is manageable.
              const lockedRole = u.role === 'superadmin';
              return (
                <div
                  key={u.id}
                  className={`p-4 flex items-center justify-between gap-3 ${u.status === 'disabled' ? 'opacity-60' : ''}`}
                >
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
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {u.status === 'invited' && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400">
                            <Clock className="w-3 h-3" /> {t('Inbjuden — har inte loggat in')}
                          </span>
                        )}
                        {u.status === 'disabled' && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
                            <Ban className="w-3 h-3" /> {t('Avstängd')}
                          </span>
                        )}
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
                        disabled={busyId === u.id}
                        onChange={(e) => changeRole(u, e.target.value)}
                        className="text-xs px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                      >
                        <option value="agent">{ROLE_LABELS.agent}</option>
                        <option value="admin">{ROLE_LABELS.admin}</option>
                      </select>
                    )}
                    {u.status === 'disabled' ? (
                      <button
                        onClick={() => changeStatus(u, 'active')}
                        disabled={busyId === u.id}
                        title={t('Aktivera kontot igen')}
                        className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-900/20 disabled:opacity-30 transition-colors"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => changeStatus(u, 'disabled')}
                        disabled={busyId === u.id || isSelf}
                        title={isSelf ? t('Du kan inte stänga av dig själv') : t('Stäng av kontot')}
                        className="p-1.5 rounded-md text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:text-amber-400 dark:hover:bg-amber-900/20 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => removeUser(u)}
                      disabled={busyId === u.id || isSelf}
                      title={isSelf ? t('Du kan inte ta bort dig själv') : t('Ta bort användare')}
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
