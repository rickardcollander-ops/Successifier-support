import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { auth } from '@/lib/auth';
import { requireSuperadmin } from '@/lib/api-auth';
import {
  TENANT_OVERRIDE_COOKIE,
  TENANT_OVERRIDE_MAX_AGE,
  readTenantOverride,
} from '@/lib/tenant-switch';

// The superadmin tenant switcher. POST sets the tenant we are currently
// looking at, GET reports where we are and what we can switch to. Both are
// superadmin-only; the cookie is ignored for every other role, so this is the
// only way it can ever be set to something meaningful.

export const dynamic = 'force-dynamic';

const SLIM_TENANT = { id: true, subdomain: true, name: true } as const;

function cookieOptions() {
  return {
    name: TENANT_OVERRIDE_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

/** Where we are, where home is, and every tenant we can switch to. */
export async function GET() {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  const session = await auth();
  const homeId = session?.user?.tenantId ?? null;
  const override = await readTenantOverride();

  const tenants = await prisma.tenant.findMany({
    orderBy: { name: 'asc' },
    select: SLIM_TENANT,
  });

  const home = tenants.find((t) => t.id === homeId) ?? null;
  // A stale override (tenant since deleted) resolves back to home, exactly
  // like resolveTenantForSession does for the data.
  const active = tenants.find((t) => t.id === override) ?? home;

  return NextResponse.json({
    tenants,
    active,
    home,
    switched: Boolean(active && home && active.id !== home.id),
  });
}

/** Switch to a tenant, or pass tenantId: null to go back to our own. */
export async function POST(request: NextRequest) {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  let body: { tenantId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const raw = body.tenantId;
  const tenantId = raw === null || raw === undefined ? '' : String(raw).trim();

  if (!tenantId) {
    const response = NextResponse.json({ active: null, switched: false });
    response.cookies.set({ ...cookieOptions(), value: '', maxAge: 0 });
    return response;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: SLIM_TENANT,
  });
  if (!tenant) {
    return NextResponse.json({ error: 'Arbetsytan finns inte' }, { status: 404 });
  }

  const response = NextResponse.json({ active: tenant, switched: true });
  response.cookies.set({
    ...cookieOptions(),
    value: tenant.id,
    maxAge: TENANT_OVERRIDE_MAX_AGE,
  });
  return response;
}
