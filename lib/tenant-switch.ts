import { cookies } from 'next/headers';
import {
  resolveTenantForRequest,
  resolveTenantFromHeaders,
  type TenantContext,
} from '@/lib/products/tenant';

// Superadmin tenant switching.
//
// A superadmin's User row belongs to exactly one tenant like everybody
// else's, and the session's tenant wins over the host subdomain in
// resolveTenantForRequest — so without this, the only way for us to look
// inside a customer's workspace was to move our own user there (and thereby
// out of the workspace we came from).
//
// The switch is one cookie holding the tenant id we are currently viewing.
// It is honoured ONLY for sessions whose role is 'superadmin'. That role is
// forced from SUPERADMIN_EMAILS in lib/auth.ts on every token refresh and
// cannot be self-assigned, so a non-superadmin who sets the cookie by hand
// is simply ignored — the override never widens anyone's access.

export const TENANT_OVERRIDE_COOKIE = 'sa_tenant';

/** How long a switch lasts before we snap back to our own tenant. */
export const TENANT_OVERRIDE_MAX_AGE = 60 * 60 * 12;

export interface SessionIdentity {
  role?: string | null;
  tenantId?: string | null;
}

export type TenantSource = 'override' | 'session' | 'host';

/**
 * Which tenant a request should see, given the session user and the override
 * cookie. Pure, so the precedence is testable on its own:
 * superadmin override → the user's own tenant → host subdomain / env pin.
 */
export function pickTenantId(
  user: SessionIdentity | null | undefined,
  override: string | null | undefined,
): { tenantId: string | null; source: TenantSource } {
  const switched = (override || '').trim();
  if (switched && user?.role === 'superadmin') {
    return { tenantId: switched, source: 'override' };
  }
  if (user?.tenantId) return { tenantId: user.tenantId, source: 'session' };
  return { tenantId: null, source: 'host' };
}

/** The tenant id a superadmin has switched to, or null when not switched. */
export async function readTenantOverride(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(TENANT_OVERRIDE_COOKIE)?.value?.trim() || null;
  } catch {
    // Not in a request scope (build, script) — no override.
    return null;
  }
}

/**
 * Resolve and install the request's tenant context for a signed-in user,
 * honouring an active superadmin switch. A stale cookie (tenant deleted)
 * falls back to the user's own tenant rather than the env-pinned one.
 */
export async function resolveTenantForSession(
  user: SessionIdentity | null | undefined,
): Promise<TenantContext | null> {
  const { tenantId, source } = pickTenantId(user, await readTenantOverride());
  if (source === 'override' && tenantId) {
    const ctx = await resolveTenantForRequest({ tenantId });
    if (ctx?.tenant.id === tenantId) return ctx;
    return user?.tenantId
      ? resolveTenantForRequest({ tenantId: user.tenantId })
      : resolveTenantFromHeaders();
  }
  if (tenantId) return resolveTenantForRequest({ tenantId });
  return resolveTenantFromHeaders();
}
