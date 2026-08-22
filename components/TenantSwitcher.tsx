'use client';

import { useEffect, useState } from 'react';
import { Building2, Check, ChevronDown, Loader2, RotateCcw } from 'lucide-react';

// Superadmin-only workspace switcher. Our own user belongs to one tenant like
// everybody else's, so this posts a tenant to /api/admin/tenants/switch (a
// cookie honoured only for the superadmin role) and reloads — every API call
// after that resolves to the chosen workspace. See lib/tenant-switch.ts.

interface SlimTenant {
  id: string;
  subdomain: string;
  name: string;
}

interface SwitchState {
  tenants: SlimTenant[];
  active: SlimTenant | null;
  home: SlimTenant | null;
  switched: boolean;
}

export default function TenantSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const [state, setState] = useState<SwitchState | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/tenants/switch')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setState(data);
      })
      .catch(() => {
        /* not a superadmin, or offline — render nothing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const switchTo = async (tenantId: string | null) => {
    setError(null);
    setPendingId(tenantId ?? 'home');
    try {
      const res = await fetch('/api/admin/tenants/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Kunde inte byta arbetsyta (${res.status})`);
      }
      // Every page caches tenant-scoped data client-side, so a hard reload is
      // the only honest way to land in the new workspace.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Något gick fel');
      setPendingId(null);
    }
  };

  if (!state || state.tenants.length === 0) return null;

  const activeName = state.active?.name ?? 'Ingen arbetsyta';

  if (collapsed) {
    return (
      <div className="px-3 pb-2" title={`Arbetsyta: ${activeName}`}>
        <div
          className={`flex h-9 w-full items-center justify-center rounded-xl border ${
            state.switched
              ? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
              : 'border-white/10 bg-white/[0.03] text-slate-400'
          }`}
        >
          <Building2 className="h-4 w-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 pb-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
          state.switched
            ? 'border-amber-400/50 bg-amber-400/10 hover:border-amber-400/70'
            : 'border-white/10 bg-white/[0.03] hover:border-white/25'
        }`}
      >
        <Building2
          className={`h-4 w-4 flex-shrink-0 ${state.switched ? 'text-amber-300' : 'text-[#6F7692]'}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] uppercase tracking-wide text-slate-500">
            {state.switched ? 'Visar som superadmin' : 'Arbetsyta'}
          </span>
          <span
            className={`block truncate text-xs font-medium ${
              state.switched ? 'text-amber-200' : 'text-white'
            }`}
          >
            {activeName}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-[#0B0F1A] p-1">
          {state.switched && state.home && (
            <button
              type="button"
              onClick={() => switchTo(null)}
              disabled={pendingId !== null}
              className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-amber-300 hover:bg-white/[0.06] disabled:opacity-50"
            >
              {pendingId === 'home' ? (
                <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 flex-shrink-0" />
              )}
              Tillbaka till {state.home.name}
            </button>
          )}
          {state.tenants.map((tenant) => {
            const isActive = tenant.id === state.active?.id;
            return (
              <button
                key={tenant.id}
                type="button"
                onClick={() => switchTo(tenant.id === state.home?.id ? null : tenant.id)}
                disabled={pendingId !== null || isActive}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs disabled:cursor-default ${
                  isActive ? 'bg-white/[0.06] text-white' : 'text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                {pendingId === tenant.id ? (
                  <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
                ) : isActive ? (
                  <Check className="h-3.5 w-3.5 flex-shrink-0 text-[#9F7BFF]" />
                ) : (
                  <span className="h-3.5 w-3.5 flex-shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{tenant.name}</span>
                <span className="flex-shrink-0 text-[10px] text-slate-500">{tenant.subdomain}</span>
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
