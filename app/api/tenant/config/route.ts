import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getActiveTenantConfig } from '@/lib/products';
import { resolveTenantForRequest, resolveTenantFromHeaders } from '@/lib/products/tenant';

// The active tenant's effective configuration for this request (session
// tenant → host subdomain → env pin). Fetched by the client provider so
// statically rendered shells still show the right tenant's branding at
// runtime. The config is not secret — it's the same object that reaches the
// client bundle via SSR injection.

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth().catch(() => null);
  const tenantId = session?.user?.tenantId ?? null;
  if (tenantId) {
    await resolveTenantForRequest({ tenantId });
  } else {
    await resolveTenantFromHeaders();
  }
  return NextResponse.json({ config: getActiveTenantConfig() });
}
