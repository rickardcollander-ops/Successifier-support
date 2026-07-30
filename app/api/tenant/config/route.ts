import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getActiveTenantConfig } from '@/lib/products';
import { resolveTenantForRequest, resolveTenantFromHeaders } from '@/lib/products/tenant';
import { billingState } from '@/lib/billing';

// The active tenant's effective configuration for this request (session
// tenant → host subdomain → env pin). Fetched by the client provider so
// statically rendered shells still show the right tenant's branding at
// runtime. The config is not secret — it's the same object that reaches the
// client bundle via SSR injection.

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth().catch(() => null);
  const tenantId = session?.user?.tenantId ?? null;
  const ctx = tenantId
    ? await resolveTenantForRequest({ tenantId })
    : await resolveTenantFromHeaders();
  return NextResponse.json({
    // Use the resolved context directly — AsyncLocalStorage propagation
    // across Next's request plumbing is not reliable enough to read the
    // ambient config here.
    config: ctx?.config ?? getActiveTenantConfig(),
    // Billing state drives the app chrome (trial/payment banners, lockout
    // screen). Plan/status only — no Stripe references leave the server.
    billing: ctx ? billingState(ctx.tenant) : null,
  });
}
