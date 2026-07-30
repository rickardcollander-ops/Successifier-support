import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tenant } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import {
  PRODUCT_KEY,
  PRODUCT_PRESETS,
  DEFAULT_TENANT_CONFIG,
  mergeTenantConfig,
  __registerServerConfigSource,
  __setProcessDefaultConfig,
  type ProductConfig,
} from './index';

// Server-only tenant resolution. One deployment serves MANY tenants: each
// request resolves its tenant (by session tenantId, API key, host subdomain
// or the legacy env pin) and installs it in AsyncLocalStorage, so every
// `product.*` read during that request sees that tenant's configuration.
//
// Do NOT import this from client components — it pulls in prisma and
// node:async_hooks.

export interface TenantContext {
  tenant: Tenant;
  config: ProductConfig;
}

const als = new AsyncLocalStorage<TenantContext>();
__registerServerConfigSource(() => als.getStore()?.config ?? null);

/** The tenant context of the current request, if one has been resolved. */
export function currentTenantContext(): TenantContext | null {
  return als.getStore() ?? null;
}

/**
 * Build the effective config for a tenant row: platform defaults, then the
 * launch customer's code preset (if any), then the tenant's DB settings.
 * For preset-less tenants the tenant's display name doubles as the brand.
 */
export function buildTenantConfig(tenant: Tenant): ProductConfig {
  const preset = PRODUCT_PRESETS[tenant.subdomain];
  let config = mergeTenantConfig(DEFAULT_TENANT_CONFIG, preset);
  if (!preset) {
    config = mergeTenantConfig(config, {
      displayName: tenant.name,
      brandName: tenant.name,
      supportName: `${tenant.name} Support`,
      fromName: `${tenant.name} Support`,
    });
  }
  config = mergeTenantConfig(config, tenant.settings as Partial<ProductConfig> | null);
  // The key always mirrors the subdomain — it is the tenant's identity and
  // must not be overridable from settings.
  config.key = tenant.subdomain;
  return config;
}

// Short TTL cache so settings edits show up quickly without a DB hit on
// every product.* read path.
const CACHE_TTL_MS = 30_000;
interface CacheEntry {
  ctx: TenantContext | null;
  expires: number;
}
const tenantCache = new Map<string, CacheEntry>();

function cacheGet(cacheKey: string): CacheEntry | undefined {
  const entry = tenantCache.get(cacheKey);
  if (entry && entry.expires > Date.now()) return entry;
  tenantCache.delete(cacheKey);
  return undefined;
}

function cacheSet(cacheKey: string, ctx: TenantContext | null): void {
  tenantCache.set(cacheKey, { ctx, expires: Date.now() + CACHE_TTL_MS });
}

/** Drop cached config (call after updating Tenant.settings). */
export function invalidateTenantCache(): void {
  tenantCache.clear();
}

async function loadTenant(where: { id: string } | { subdomain: string }): Promise<TenantContext | null> {
  const cacheKey = 'id' in where ? `id:${where.id}` : `sub:${where.subdomain}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached.ctx;
  let tenant: Tenant | null = null;
  try {
    tenant = await prisma.tenant.findUnique({ where: where as { id: string } });
  } catch (error) {
    // DB unreachable (build-time prerender, cold start) — fall back to the
    // env-pinned config rather than failing the whole render. Not cached so
    // the next request retries.
    console.error('[tenant] Failed to load tenant, falling back to env config:', error);
    return null;
  }
  const ctx = tenant ? { tenant, config: buildTenantConfig(tenant) } : null;
  cacheSet(cacheKey, ctx);
  if (ctx) {
    cacheSet(`id:${ctx.tenant.id}`, ctx);
    cacheSet(`sub:${ctx.tenant.subdomain}`, ctx);
    // On an env-pinned (single-tenant) deployment this tenant is what every
    // `product.*` read should reflect, including reads outside a resolved
    // request context — keep the process-level fallback in sync with the DB.
    if (ctx.tenant.subdomain === PRODUCT_KEY) {
      __setProcessDefaultConfig(ctx.config);
    }
  }
  return ctx;
}

export async function resolveTenantById(id: string): Promise<TenantContext | null> {
  return loadTenant({ id });
}

export async function resolveTenantBySubdomain(subdomain: string): Promise<TenantContext | null> {
  return loadTenant({ subdomain: subdomain.trim().toLowerCase() });
}

/**
 * Extract a candidate tenant subdomain from a request Host header:
 * "acme.successifier.app" → "acme". Returns null for the bare root domain,
 * localhost and IPs. The root domain defaults to successifier.app and is
 * overridable via TENANT_ROOT_DOMAIN.
 */
export function hostToSubdomain(host: string | null | undefined): string | null {
  if (!host) return null;
  const clean = host.split(':')[0].trim().toLowerCase();
  if (!clean || clean === 'localhost' || /^[0-9.]+$/.test(clean)) return null;
  const root = (process.env.TENANT_ROOT_DOMAIN || 'successifier.app').toLowerCase();
  if (clean === root || !clean.endsWith(`.${root}`)) return null;
  const sub = clean.slice(0, -(root.length + 1));
  if (!sub || sub === 'www' || sub.includes('.')) return null;
  return sub;
}

/**
 * Resolve the tenant for the current request and install it in the request
 * context. Resolution order:
 *   1. explicit tenantId (from the session user or a validated API key)
 *   2. host subdomain (acme.successifier.app → tenant "acme")
 *   3. the legacy env pin (PRODUCT / NEXT_PUBLIC_PRODUCT)
 * Returns null when no tenant matches (e.g. before the DB is seeded).
 */
export async function resolveTenantForRequest(opts: {
  tenantId?: string | null;
  host?: string | null;
} = {}): Promise<TenantContext | null> {
  let ctx: TenantContext | null = null;
  if (opts.tenantId) ctx = await resolveTenantById(opts.tenantId);
  if (!ctx) {
    const sub = hostToSubdomain(opts.host);
    if (sub) ctx = await resolveTenantBySubdomain(sub);
  }
  if (!ctx) ctx = await resolveTenantBySubdomain(PRODUCT_KEY);
  if (ctx) als.enterWith(ctx);
  return ctx;
}

/**
 * Resolve the tenant for a server component / route using the incoming
 * request headers (host-based), falling back to the env pin. Safe to call
 * outside a request scope (falls back to the env pin).
 */
export async function resolveTenantFromHeaders(): Promise<TenantContext | null> {
  let host: string | null = null;
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    host = h.get('host');
  } catch {
    // Not in a request scope (build, script) — fall through to env pin.
  }
  return resolveTenantForRequest({ host });
}

/**
 * Resolve the Tenant row for the current request (or the env-pinned tenant
 * when no request context exists). Preserved API from the single-tenant era —
 * callers should handle null the same way they handled a missing tenant.
 */
export async function getTenant(): Promise<Tenant | null> {
  const store = als.getStore();
  if (store) return store.tenant;
  // No context installed yet — resolve from the request headers (host
  // subdomain) when available, otherwise the env pin. This makes every
  // legacy getTenantId() call site host-aware for free.
  const ctx = await resolveTenantFromHeaders();
  return ctx?.tenant ?? null;
}

/** Resolve just the tenant id for the current request, or null if unseeded. */
export async function getTenantId(): Promise<string | null> {
  const tenant = await getTenant();
  return tenant?.id ?? null;
}
