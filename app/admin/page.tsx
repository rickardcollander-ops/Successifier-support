'use client';

import { useEffect, useState } from 'react';
import { Shield, Plus, Building2, Users, Ticket, BookOpen, Bot, Loader2, Settings2, ChevronDown } from 'lucide-react';
import TenantSettingsEditor from '@/components/admin/TenantSettingsEditor';

interface Tenant {
  id: string;
  subdomain: string;
  name: string;
  createdAt: string;
  plan: string;
  billingStatus: string;
  trialEndsAt: string | null;
  _count: {
    users: number;
    tickets: number;
    knowledge: number;
    agents: number;
  };
}

const BILLING_BADGE: Record<string, { label: string; className: string }> = {
  trialing: { label: 'Provperiod', className: 'border-sky-400/40 bg-sky-400/10 text-sky-300' },
  active: { label: 'Aktiv', className: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' },
  past_due: { label: 'Förfallen', className: 'border-amber-400/40 bg-amber-400/10 text-amber-300' },
  canceled: { label: 'Avslutad', className: 'border-red-400/40 bg-red-400/10 text-red-300' },
  suspended: { label: 'Avstängd', className: 'border-red-400/40 bg-red-400/10 text-red-300' },
};

export default function AdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [domain, setDomain] = useState('');
  const [authProvider, setAuthProvider] = useState('google');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [openTenantId, setOpenTenantId] = useState<string | null>(null);

  const loadTenants = async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/tenants');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Kunde inte hämta tenants (${res.status})`);
      }
      const data = await res.json();
      setTenants(data.tenants ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Något gick fel');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreating(true);
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, subdomain, adminEmail, domain, authProviders: [authProvider] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Kunde inte skapa tenant (${res.status})`);
      }
      setName('');
      setSubdomain('');
      setAuthProvider('google');
      setAdminEmail('');
      setDomain('');
      await loadTenants();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Något gick fel');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#7C5CFF] to-[#9F7BFF]">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-sm text-slate-400">Skapa och håll koll på tenants</p>
        </div>
      </header>

      {/* Create tenant */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="flex items-center gap-2 text-lg font-medium mb-4">
          <Plus className="h-5 w-5 text-[#9F7BFF]" />
          Ny tenant
        </h2>
        <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Namn</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme AB"
              className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Subdomän</label>
            <input
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
              placeholder="acme"
              className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Första admin (e-post, valfritt)</label>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="anna@acme.se"
              className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Tillåten e-postdomän (valfritt)</label>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value.toLowerCase())}
              placeholder="acme.se"
              className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-xs text-slate-400">Inloggningssätt</label>
            <select
              value={authProvider}
              onChange={(e) => setAuthProvider(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
            >
              <option value="google">Google (Workspace/Gmail)</option>
              <option value="resend">Magisk länk via e-post</option>
            </select>
            <p className="text-[11px] text-slate-500">
              Välj ett sätt. Magisk länk kräver att kunden har en aktiv Resend-integration
              eller att AUTH_RESEND_KEY/AUTH_EMAIL_FROM är satta. Kan ändras senare per tenant.
            </p>
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Skapa tenant
            </button>
          </div>
        </form>
        {formError && <p className="mt-3 text-sm text-red-400">{formError}</p>}
      </section>

      {/* Tenant list */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Building2 className="h-5 w-5 text-[#9F7BFF]" />
          Befintliga tenants
          {!loading && <span className="text-sm text-slate-500">({tenants.length})</span>}
        </h2>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Laddar…
          </div>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : tenants.length === 0 ? (
          <p className="text-sm text-slate-400">Inga tenants ännu.</p>
        ) : (
          <div className="grid gap-3">
            {tenants.map((tn) => (
              <div
                key={tn.id}
                className="rounded-2xl border border-white/10 bg-white/[0.02] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      {tn.name}
                      {(() => {
                        const badge = BILLING_BADGE[tn.billingStatus];
                        return badge ? (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
                            {badge.label}
                            {tn.billingStatus === 'trialing' && tn.trialEndsAt
                              ? ` → ${new Date(tn.trialEndsAt).toLocaleDateString('sv-SE')}`
                              : ''}
                          </span>
                        ) : null;
                      })()}
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400">
                        {tn.plan}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {tn.subdomain} · skapad {new Date(tn.createdAt).toLocaleDateString('sv-SE')}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <Stat icon={Users} label="Användare" value={tn._count.users} />
                    <Stat icon={Ticket} label="Ärenden" value={tn._count.tickets} />
                    <Stat icon={BookOpen} label="Artiklar" value={tn._count.knowledge} />
                    <Stat icon={Bot} label="Agenter" value={tn._count.agents} />
                    <button
                      type="button"
                      onClick={() => setOpenTenantId(openTenantId === tn.id ? null : tn.id)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        openTenantId === tn.id
                          ? 'border-[#7C5CFF] bg-[#7C5CFF]/15 text-[#C9B8FF]'
                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Konfigurera
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${openTenantId === tn.id ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>
                </div>
                {openTenantId === tn.id && (
                  <TenantSettingsEditor tenantId={tn.id} onSaved={loadTenants} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 text-slate-300" title={label}>
      <Icon className="h-4 w-4 text-[#6F7692]" />
      <span className="font-semibold">{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}
