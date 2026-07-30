import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireSuperadmin } from '@/lib/api-auth';
import { buildTenantConfig, invalidateTenantCache } from '@/lib/products/tenant';
import { DEFAULT_TENANT_CONFIG } from '@/lib/products';

// Superadmin management of a single tenant: read its stored settings and
// effective (merged) configuration, and update name/settings at runtime —
// no redeploy needed for branding, agents, integrations, sign-in domains…

// The settings keys a superadmin may store. Mirrors ProductConfig minus
// `key` (the tenant's identity, never settings-overridable).
const ALLOWED_SETTINGS_KEYS = new Set([
  'displayName',
  'brandName',
  'language',
  'supportName',
  'fromName',
  'apiKeyPrefix',
  'apiBaseDomain',
  'integrations',
  'showAffectedCustomersTool',
  'translateIncoming',
  'sendConfirmation',
  'vendorFolder',
  'allowedDomains',
  'adminEmails',
  'agents',
  'agentSignatures',
  'agentColors',
  'confirmation',
]);

async function loadTenant(id: string) {
  return prisma.tenant.findFirst({
    where: { OR: [{ id }, { subdomain: id }] },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  const { id } = await params;
  const tenant = await loadTenant(id);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      subdomain: tenant.subdomain,
      name: tenant.name,
      createdAt: tenant.createdAt,
      settings: tenant.settings ?? {},
    },
    // The merged config actually served to this tenant (defaults + preset +
    // settings) — what the operator sees in the UI after their edits.
    effectiveConfig: buildTenantConfig(tenant),
    defaults: DEFAULT_TENANT_CONFIG,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  const { id } = await params;
  const tenant = await loadTenant(id);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  let body: { name?: unknown; settings?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: { name?: string; settings?: object } = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: 'Namn krävs' }, { status: 400 });
    data.name = name;
  }

  if (body.settings !== undefined) {
    if (body.settings === null || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
      return NextResponse.json({ error: 'settings måste vara ett JSON-objekt' }, { status: 400 });
    }
    const unknownKeys = Object.keys(body.settings).filter((k) => !ALLOWED_SETTINGS_KEYS.has(k));
    if (unknownKeys.length) {
      return NextResponse.json(
        { error: `Okända settings-nycklar: ${unknownKeys.join(', ')}` },
        { status: 400 },
      );
    }
    // Replace-not-merge: the stored settings object IS the tenant's override
    // set, so the editor sends the full object and removal of a key restores
    // the default.
    data.settings = body.settings;
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: 'Inget att uppdatera' }, { status: 400 });
  }

  const updated = await prisma.tenant.update({ where: { id: tenant.id }, data });
  invalidateTenantCache();

  return NextResponse.json({
    tenant: {
      id: updated.id,
      subdomain: updated.subdomain,
      name: updated.name,
      settings: updated.settings ?? {},
    },
    effectiveConfig: buildTenantConfig(updated),
  });
}
