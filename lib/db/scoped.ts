import { prisma } from '@/lib/db/client';
import { getTenantId } from '@/lib/products/tenant';

// Tenant-scoped lookups. Every route that takes an object id from the URL
// must resolve it through the deployment's tenant so a valid session or API
// key can never read or mutate another tenant's rows. Follows the same
// "filter only when the tenant row exists" convention as
// app/api/integrations/[id]/route.ts (an unseeded deployment has no tenant
// row yet).

export async function findScopedTicket(id: string) {
  const tenantId = await getTenantId();
  return prisma.ticket.findFirst({
    where: { id, ...(tenantId ? { tenantId } : {}) },
  });
}

export async function findScopedKnowledge(id: string) {
  const tenantId = await getTenantId();
  return prisma.knowledgeBase.findFirst({
    where: { id, ...(tenantId ? { tenantId } : {}) },
  });
}

/**
 * Find an EmailAccount that may be used by this deployment: it must belong
 * to a user of the deployment's tenant. Used by the send route so an
 * arbitrary `fromAccountId` can't select another tenant's inbox.
 */
export async function findScopedEmailAccount(id: string) {
  const tenantId = await getTenantId();
  return prisma.emailAccount.findFirst({
    where: { id, ...(tenantId ? { user: { tenantId } } : {}) },
  });
}

/**
 * Find a webhook endpoint belonging to this deployment's tenant, so an id
 * taken from the URL can never reach another tenant's destination.
 */
export async function findScopedWebhook(id: string) {
  const tenantId = await getTenantId();
  return prisma.webhookEndpoint.findFirst({
    where: { id, ...(tenantId ? { tenantId } : {}) },
  });
}
