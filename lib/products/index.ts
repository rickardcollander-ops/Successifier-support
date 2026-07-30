import type { ProductConfig } from './types';
import { doldadress } from './doldadress';
import { serus } from './serus';
import { DEFAULT_TENANT_CONFIG, mergeTenantConfig } from './defaults';

export type { ProductConfig, AgentColor } from './types';
export { DEFAULT_TENANT_CONFIG, mergeTenantConfig } from './defaults';

// Code presets for the launch customers. New tenants do NOT get a preset —
// their entire configuration lives in Tenant.settings (overlaid on
// DEFAULT_TENANT_CONFIG). The presets remain as the base config for the
// original customers and as the env-pinned fallback for single-tenant
// deployments that predate runtime tenant resolution.
export const PRODUCT_PRESETS: Record<string, ProductConfig> = {
  doldadress,
  serus,
};

// Legacy env pin. On a single-tenant deployment this selects which tenant
// the process serves when a request carries no other tenant signal (no
// session tenant, no API key, no matching host). Optional in the
// multi-tenant setup.
export const PRODUCT_KEY = (
  process.env.NEXT_PUBLIC_PRODUCT ||
  process.env.PRODUCT ||
  'doldadress'
)
  .trim()
  .toLowerCase();

const ENV_FALLBACK_CONFIG: ProductConfig = mergeTenantConfig(
  DEFAULT_TENANT_CONFIG,
  PRODUCT_PRESETS[PRODUCT_KEY],
);

// ---------------------------------------------------------------------------
// Active-config plumbing.
//
// `product` used to be a build-time constant, which forced one deployment
// (and one env var) per customer. It is now a live view of the ACTIVE
// tenant's configuration:
//
//   - On the server, lib/products/tenant.ts registers a per-request source
//     backed by AsyncLocalStorage; every request resolves its tenant
//     (session → API key → host subdomain → env fallback) and all
//     `product.*` reads inside that request see that tenant's config.
//   - On the client, TenantConfigProvider (app/providers.tsx) receives the
//     resolved config from the server layout and installs it before any
//     child renders.
//   - With neither installed (scripts, early module init) reads fall back
//     to the env-pinned preset, preserving the old behavior.
//
// IMPORTANT: never capture `product.x` in a module-level constant — that
// freezes one tenant's value into shared module state. Read it lazily
// inside functions/components instead.
// ---------------------------------------------------------------------------

let clientActiveConfig: ProductConfig | null = null;
let serverConfigSource: (() => ProductConfig | null) | null = null;
// DB-backed config for the env-pinned tenant this process serves. Set by
// lib/products/tenant.ts as soon as that tenant is first loaded, so deep
// `product.*` reads on a single-tenant deployment reflect the tenant's
// database settings even outside a resolved request context.
let processDefaultConfig: ProductConfig | null = null;

/** Install the active config on the client (called by TenantConfigProvider). */
export function setActiveTenantConfig(config: ProductConfig | null): void {
  clientActiveConfig = config;
}

/** @internal Registered by lib/products/tenant.ts (server only). */
export function __registerServerConfigSource(source: () => ProductConfig | null): void {
  serverConfigSource = source;
}

/** @internal Set by lib/products/tenant.ts when the env-pinned tenant loads. */
export function __setProcessDefaultConfig(config: ProductConfig): void {
  processDefaultConfig = config;
}

/** The currently active tenant configuration. */
export function getActiveTenantConfig(): ProductConfig {
  return serverConfigSource?.() ?? clientActiveConfig ?? processDefaultConfig ?? ENV_FALLBACK_CONFIG;
}

/**
 * Live view of the active tenant's configuration. Kept under the historic
 * `product` name so the ~100 existing read sites keep working unchanged —
 * but every property access now resolves against the active tenant at call
 * time instead of a build-time constant.
 */
export const product: ProductConfig = new Proxy({} as ProductConfig, {
  get(_target, prop) {
    return getActiveTenantConfig()[prop as keyof ProductConfig];
  },
  has(_target, prop) {
    return prop in getActiveTenantConfig();
  },
  ownKeys() {
    return Reflect.ownKeys(getActiveTenantConfig());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const desc = Object.getOwnPropertyDescriptor(getActiveTenantConfig(), prop);
    return desc ? { ...desc, configurable: true } : undefined;
  },
});
