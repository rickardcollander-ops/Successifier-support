import { describe, expect, it } from 'vitest';
import { pickTenantId } from '@/lib/tenant-switch';

// The superadmin workspace switch is the only thing that may override the
// tenant baked into a session, and only for the superadmin role. Everything
// else must keep resolving to the user's own tenant — a regular agent who
// hand-crafts the cookie must not reach another customer's data.

describe('pickTenantId', () => {
  const superadmin = { role: 'superadmin', tenantId: 'own-tenant' };

  it('uses the override for a superadmin', () => {
    expect(pickTenantId(superadmin, 'other-tenant')).toEqual({
      tenantId: 'other-tenant',
      source: 'override',
    });
  });

  it('falls back to the superadmin own tenant with no override', () => {
    expect(pickTenantId(superadmin, null)).toEqual({
      tenantId: 'own-tenant',
      source: 'session',
    });
    expect(pickTenantId(superadmin, '   ')).toEqual({
      tenantId: 'own-tenant',
      source: 'session',
    });
  });

  it('ignores the override for every other role', () => {
    for (const role of ['agent', 'admin', null, undefined]) {
      expect(pickTenantId({ role, tenantId: 'own-tenant' }, 'other-tenant')).toEqual({
        tenantId: 'own-tenant',
        source: 'session',
      });
    }
  });

  it('ignores the override for a signed-out request', () => {
    expect(pickTenantId(null, 'other-tenant')).toEqual({ tenantId: null, source: 'host' });
    expect(pickTenantId(undefined, 'other-tenant')).toEqual({ tenantId: null, source: 'host' });
  });

  it('leaves a tenant-less user to the host/env fallback', () => {
    expect(pickTenantId({ role: 'agent', tenantId: null }, null)).toEqual({
      tenantId: null,
      source: 'host',
    });
  });

  it('lets a superadmin without an own tenant still switch', () => {
    expect(pickTenantId({ role: 'superadmin', tenantId: null }, 'other-tenant')).toEqual({
      tenantId: 'other-tenant',
      source: 'override',
    });
  });
});
