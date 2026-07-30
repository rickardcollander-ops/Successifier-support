import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { auth } from '@/lib/auth';
import { hashApiKey, maskApiKey } from '@/lib/api-keys';
import {
  hostToSubdomain,
  resolveTenantBySubdomain,
  resolveTenantForRequest,
  resolveTenantFromHeaders,
} from '@/lib/products/tenant';

export { generateApiKey, hashApiKey, maskApiKey } from '@/lib/api-keys';

// API keys are stored as SHA-256 hashes (ApiKey.key). The plaintext key is
// only shown once, in the response that creates it. Legacy rows that still
// hold a plaintext key are upgraded in place on first successful use.

function extractApiKey(request: NextRequest): string | null {
  return (
    request.headers.get('x-api-key') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    null
  );
}

export async function validateApiKey(request: NextRequest): Promise<{ valid: boolean; tenantId?: string; error?: string }> {
  const apiKey = extractApiKey(request);

  if (!apiKey) {
    return { valid: false, error: 'API key is required' };
  }

  try {
    const hashed = hashApiKey(apiKey);
    let key = await prisma.apiKey.findUnique({
      where: { key: hashed },
    });

    if (!key) {
      // Legacy row with the key stored in plaintext — upgrade it to the
      // hashed format on first successful use.
      const legacy = await prisma.apiKey.findUnique({ where: { key: apiKey } });
      if (legacy) {
        key = await prisma.apiKey.update({
          where: { id: legacy.id },
          data: { key: hashed, maskedKey: maskApiKey(apiKey) },
        });
      }
    }

    if (!key) {
      return { valid: false, error: 'Invalid API key' };
    }

    if (!key.isActive) {
      return { valid: false, error: 'API key is inactive' };
    }

    // When the request targets a specific tenant's subdomain, a key minted
    // for another tenant must not work there. On the shared/root domain the
    // key itself identifies the tenant.
    const hostSub = hostToSubdomain(request.headers.get('host'));
    if (hostSub) {
      const hostCtx = await resolveTenantBySubdomain(hostSub);
      if (hostCtx && key.tenantId !== hostCtx.tenant.id) {
        return { valid: false, error: 'Invalid API key' };
      }
    }

    await prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    // Install the key's tenant as the request context so all product.*
    // reads downstream see the right tenant's configuration.
    await resolveTenantForRequest({ tenantId: key.tenantId });

    return { valid: true, tenantId: key.tenantId };
  } catch (error) {
    console.error('API key validation error:', error);
    return { valid: false, error: 'Internal server error' };
  }
}

type SessionAuth = { ok: true; via: 'session'; userEmail: string; role: string };

/**
 * Install the signed-in user's tenant as the request context: the tenant on
 * the session token first, then host subdomain / env pin as fallback.
 */
async function enterSessionTenant(tenantId?: string | null): Promise<void> {
  if (tenantId) {
    await resolveTenantForRequest({ tenantId });
  } else {
    await resolveTenantFromHeaders();
  }
}
type ApiKeyAuth = { ok: true; via: 'api-key'; tenantId: string };
type AuthFailure = { ok: false; response: NextResponse };

export type ApiAuthResult = SessionAuth | ApiKeyAuth | AuthFailure;

function unauthorized(message = 'Unauthorized'): AuthFailure {
  return { ok: false, response: NextResponse.json({ error: message }, { status: 401 }) };
}

/**
 * Require a signed-in session OR a valid API key. Use in every API route
 * that serves both the web UI and programmatic clients. The middleware
 * intentionally lets API requests through so this check is THE auth gate.
 */
export async function requireApiAuth(request: NextRequest): Promise<ApiAuthResult> {
  const session = await auth();
  if (session?.user?.email) {
    await enterSessionTenant(session.user.tenantId);
    return { ok: true, via: 'session', userEmail: session.user.email, role: session.user.role || 'agent' };
  }

  if (extractApiKey(request)) {
    const result = await validateApiKey(request);
    if (result.valid && result.tenantId) {
      return { ok: true, via: 'api-key', tenantId: result.tenantId };
    }
    return unauthorized(result.error || 'Invalid API key');
  }

  return unauthorized();
}

/**
 * Require a signed-in session (API keys not accepted). Use for routes that
 * manage credentials, API keys or other operator-only resources.
 */
export async function requireSession(): Promise<SessionAuth | AuthFailure> {
  const session = await auth();
  if (session?.user?.email) {
    await enterSessionTenant(session.user.tenantId);
    return { ok: true, via: 'session', userEmail: session.user.email, role: session.user.role || 'agent' };
  }
  return unauthorized();
}

/** Require a signed-in session with the superadmin role. */
export async function requireSuperadmin(): Promise<SessionAuth | AuthFailure> {
  const session = await auth();
  if (!session?.user?.email) {
    return unauthorized();
  }
  if (session.user.role !== 'superadmin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  await enterSessionTenant(session.user.tenantId);
  return { ok: true, via: 'session', userEmail: session.user.email, role: session.user.role };
}

/**
 * Require a signed-in settings admin (Ida or a superadmin). Use for every
 * Settings-area API: integrations, blocked senders, inbox tabs, users, etc.
 * API keys are not accepted — these are operator-only actions.
 */
export async function requireSettingsAdmin(): Promise<SessionAuth | AuthFailure> {
  const session = await auth();
  if (!session?.user?.email) {
    return unauthorized();
  }
  if (!session.user.isSettingsAdmin) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  await enterSessionTenant(session.user.tenantId);
  return { ok: true, via: 'session', userEmail: session.user.email, role: session.user.role || 'agent' };
}
