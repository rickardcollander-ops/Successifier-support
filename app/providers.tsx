'use client';

import { useEffect, useState } from 'react';
import { SessionProvider } from 'next-auth/react';
import { setActiveTenantConfig, type ProductConfig } from '@/lib/products';

// Installs the tenant config resolved by the SERVER layout (host/session
// based) as the active client config. The call happens during render —
// before any child renders — so every `product.*` read in child client
// components sees the right tenant from the very first paint.
//
// A statically prerendered shell may carry the env-fallback config instead
// of the request's real tenant, so after mount we re-fetch the effective
// config from /api/tenant/config and re-render if it differs.
function TenantConfigProvider({
  config,
  children,
}: {
  config: ProductConfig | null;
  children: React.ReactNode;
}) {
  const [activeConfig, setConfig] = useState<ProductConfig | null>(config);
  if (activeConfig) setActiveTenantConfig(activeConfig);

  useEffect(() => {
    if (activeConfig) setActiveTenantConfig(activeConfig);
  }, [activeConfig]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tenant/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.config) return;
        setConfig((prev) =>
          JSON.stringify(prev) === JSON.stringify(data.config) ? prev : data.config,
        );
      })
      .catch(() => {
        /* keep the SSR-injected config */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}

export function Providers({
  children,
  tenantConfig,
}: {
  children: React.ReactNode;
  tenantConfig?: ProductConfig | null;
}) {
  return (
    <SessionProvider>
      <TenantConfigProvider config={tenantConfig ?? null}>{children}</TenantConfigProvider>
    </SessionProvider>
  );
}
