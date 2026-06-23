'use client';

import { useEffect, useState } from 'react';
import { Shield, Plus, Building2, Users, Ticket, BookOpen, Bot, Loader2 } from 'lucide-react';

interface Tenant {
  id: string;
  subdomain: string;
  name: string;
  createdAt: string;
  _count: {
    users: number;
    tickets: number;
    knowledge: number;
    agents: number;
  };
}

export default function AdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
        body: JSON.stringify({ name, subdomain }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Kunde inte skapa tenant (${res.status})`);
      }
      setName('');
      setSubdomain('');
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
        <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Namn</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Doldadress"
              className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Subdomän</label>
            <input
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
              placeholder="doldadress"
              className="rounded-lg border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm focus:border-[#7C5CFF] focus:outline-none"
              required
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Skapa
          </button>
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
                    <div className="font-medium">{tn.name}</div>
                    <div className="text-xs text-slate-400">
                      {tn.subdomain} · skapad {new Date(tn.createdAt).toLocaleDateString('sv-SE')}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <Stat icon={Users} label="Användare" value={tn._count.users} />
                    <Stat icon={Ticket} label="Ärenden" value={tn._count.tickets} />
                    <Stat icon={BookOpen} label="Artiklar" value={tn._count.knowledge} />
                    <Stat icon={Bot} label="Agenter" value={tn._count.agents} />
                  </div>
                </div>
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
