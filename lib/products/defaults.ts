import type { ProductConfig } from './types';

// Platform-neutral defaults for a brand-new tenant. Every field a tenant
// doesn't override in Tenant.settings falls back to these values, so a
// freshly onboarded customer gets a working (if unbranded) product with
// zero code changes. Import-safe from client components.
export const DEFAULT_TENANT_CONFIG: ProductConfig = {
  key: 'default',
  displayName: 'Successifier',
  brandName: 'Successifier',
  language: 'sv',
  supportName: 'Successifier Support',
  fromName: 'Successifier Support',
  apiKeyPrefix: 'scs',
  apiBaseDomain: 'successifier.com',
  integrations: ['stripe', 'retool', 'resend', 'gmail', 'postman'],
  showAffectedCustomersTool: false,
  translateIncoming: false,
  sendConfirmation: true,
  vendorFolder: {
    label: 'Leverantör',
    senders: [],
  },
  allowedDomains: [],
  adminEmails: [],
  agents: [],
  agentSignatures: {},
  agentColors: {},
  confirmation: {
    greeting: 'Hej,',
    bodyLines: [
      'Tack för att du kontaktar oss!',
      'Vi har tagit emot ditt mejl och hanterar ditt ärende så snart som möjligt.',
      'Ha en fin dag!',
    ],
    signoff: 'Med vänliga hälsningar,\nSupportteamet',
  },
};

function definedEntries<T extends object>(partial: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * Overlay a partial config (e.g. the Tenant.settings JSON) on top of a base
 * config. null/undefined values in the partial are ignored so a sparse DB
 * row never wipes a default. The nested `vendorFolder` and `confirmation`
 * objects are merged field-by-field for the same reason.
 */
export function mergeTenantConfig(
  base: ProductConfig,
  partial?: Partial<ProductConfig> | null,
): ProductConfig {
  if (!partial || typeof partial !== 'object') return base;
  const flat = definedEntries(partial);
  const out: ProductConfig = { ...base, ...flat };
  if (partial.vendorFolder && typeof partial.vendorFolder === 'object') {
    out.vendorFolder = { ...base.vendorFolder, ...definedEntries(partial.vendorFolder) };
  }
  if (partial.confirmation && typeof partial.confirmation === 'object') {
    out.confirmation = { ...base.confirmation, ...definedEntries(partial.confirmation) };
  }
  return out;
}
