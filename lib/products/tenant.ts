import type { Tenant } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { product } from './index';

// Server-only helpers for resolving the Tenant row of the product this
// deployment serves. Each deployment is pinned to a single product/tenant
// (see lib/products), so the lookup is by the product key (== subdomain).
//
// Do NOT import this from client components — it pulls in prisma.

let cachedTenant: Tenant | null = null;

/**
 * Resolve the Tenant row for the active product. Cached for the lifetime of
 * the process (a deployment serves exactly one tenant). Returns null only
 * when the tenant row hasn't been created yet — callers should handle that
 * the same way they previously handled a missing tenant.
 */
export async function getTenant(): Promise<Tenant | null> {
  if (cachedTenant) return cachedTenant;
  const tenant = await prisma.tenant.findUnique({
    where: { subdomain: product.key },
  });
  if (tenant) cachedTenant = tenant;
  return tenant;
}

/** Resolve just the tenant id for the active product, or null if unseeded. */
export async function getTenantId(): Promise<string | null> {
  const tenant = await getTenant();
  return tenant?.id ?? null;
}
