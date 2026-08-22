import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireSuperadmin } from '@/lib/api-auth';
import { buildTenantConfig, invalidateTenantCache } from '@/lib/products/tenant';
import { DEFAULT_TENANT_CONFIG } from '@/lib/products';
import { AUTH_PROVIDERS } from '@/lib/products/types';

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
  'authProviders',
  'allowDomainAutoJoin',
  'adminEmails',
  'agents',
  'agentSignatures',
  'agentColors',
  'confirmation',
  'ticketCategories',
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
    billing: {
      plan: tenant.plan,
      billingStatus: tenant.billingStatus,
      trialEndsAt: tenant.trialEndsAt,
      stripeCustomerId: tenant.stripeCustomerId,
      stripeSubscriptionId: tenant.stripeSubscriptionId,
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

  let body: { name?: unknown; settings?: unknown; billing?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: {
    name?: string;
    settings?: object;
    plan?: string;
    billingStatus?: string;
    trialEndsAt?: Date | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  } = {};

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
    // authProviders decides who can sign in at all, so its VALUES are checked
    // too — an unknown entry ('Google', 'microsoft') would leave the tenant
    // with a non-empty list containing no usable method and lock everyone out.
    const settings = body.settings as Record<string, unknown>;
    if (settings.authProviders !== undefined) {
      const providers = settings.authProviders;
      if (!Array.isArray(providers) || providers.length === 0) {
        return NextResponse.json(
          { error: 'authProviders måste vara en icke-tom lista.' },
          { status: 400 },
        );
      }
      const invalid = providers.filter((p) => !(AUTH_PROVIDERS as string[]).includes(String(p)));
      if (invalid.length) {
        return NextResponse.json(
          {
            error: `Okänt inloggningssätt: ${invalid.join(', ')}. Giltiga: ${AUTH_PROVIDERS.join(', ')}.`,
          },
          { status: 400 },
        );
      }
    }
    if (
      settings.allowDomainAutoJoin !== undefined &&
      typeof settings.allowDomainAutoJoin !== 'boolean'
    ) {
      return NextResponse.json(
        { error: 'allowDomainAutoJoin måste vara true eller false.' },
        { status: 400 },
      );
    }

    // Replace-not-merge: the stored settings object IS the tenant's override
    // set, so the editor sends the full object and removal of a key restores
    // the default.
    data.settings = body.settings;
  }

  if (body.billing !== undefined) {
    if (body.billing === null || typeof body.billing !== 'object' || Array.isArray(body.billing)) {
      return NextResponse.json({ error: 'billing måste vara ett JSON-objekt' }, { status: 400 });
    }
    const billing = body.billing as Record<string, unknown>;
    if (billing.plan !== undefined) {
      const plan = String(billing.plan);
      if (!['trial', 'starter', 'pro', 'custom'].includes(plan)) {
        return NextResponse.json({ error: `Ogiltig plan: ${plan}` }, { status: 400 });
      }
      data.plan = plan;
    }
    if (billing.billingStatus !== undefined) {
      const status = String(billing.billingStatus);
      if (!['trialing', 'active', 'past_due', 'canceled', 'suspended'].includes(status)) {
        return NextResponse.json({ error: `Ogiltig billingStatus: ${status}` }, { status: 400 });
      }
      data.billingStatus = status;
    }
    if (billing.trialEndsAt !== undefined) {
      if (billing.trialEndsAt === null || billing.trialEndsAt === '') {
        data.trialEndsAt = null;
      } else {
        const date = new Date(String(billing.trialEndsAt));
        if (Number.isNaN(date.getTime())) {
          return NextResponse.json({ error: 'Ogiltigt trialEndsAt-datum' }, { status: 400 });
        }
        data.trialEndsAt = date;
      }
    }
    if (billing.stripeCustomerId !== undefined) {
      data.stripeCustomerId = billing.stripeCustomerId ? String(billing.stripeCustomerId) : null;
    }
    if (billing.stripeSubscriptionId !== undefined) {
      data.stripeSubscriptionId = billing.stripeSubscriptionId
        ? String(billing.stripeSubscriptionId)
        : null;
    }
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
