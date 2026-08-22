import { prisma } from '@/lib/db/client';
import type { AuthProvider, ProductConfig } from '@/lib/products/types';

// The single place that answers "may this e-mail sign in to this tenant, via
// this provider?". Both the NextAuth signIn callback (lib/auth.ts) and the
// invite API (app/api/users/route.ts) read it, so the rule can never drift
// between "who gets let in" and "who gets invited".
//
// The model is deliberately identity-first: the User row decides access, the
// provider only proves the identity. That way switching a customer from
// Google to magic link (or, later, to their own OIDC) changes HOW someone
// signs in without changing WHO may sign in.

export type SignInDecision =
  | { allow: true; reason: 'superadmin' | 'provisioned' | 'domain-auto-join' }
  | { allow: false; reason: 'provider-disabled' | 'disabled-account' | 'not-invited' };

/** Lowercased, trimmed e-mail. Every comparison in here uses this form. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

export function emailDomain(email: string | null | undefined): string {
  return normalizeEmail(email).split('@')[1] || '';
}

/** The sign-in methods a tenant offers, always with at least one entry. */
export function enabledAuthProviders(config: Pick<ProductConfig, 'authProviders'>): AuthProvider[] {
  const configured = config.authProviders;
  if (!Array.isArray(configured) || configured.length === 0) return ['google'];
  return configured;
}

export function isProviderEnabled(
  config: Pick<ProductConfig, 'authProviders'>,
  provider: string,
): boolean {
  return enabledAuthProviders(config).includes(provider as AuthProvider);
}

/**
 * Decide whether `email` may sign in, given the tenant's configuration.
 *
 * `tenantId` is the tenant the request resolved to (host subdomain or env
 * pin). It may be null on a deployment that couldn't resolve one — in that
 * case only superadmins and already-provisioned users get in, which fails
 * closed rather than admitting a whole domain to an unknown tenant.
 */
export async function decideSignIn(opts: {
  email: string;
  provider: string;
  tenantId: string | null;
  config: Pick<ProductConfig, 'authProviders' | 'allowedDomains' | 'allowDomainAutoJoin'>;
  superadminEmails: string[];
}): Promise<SignInDecision> {
  const email = normalizeEmail(opts.email);

  // Superadmins (us) bypass tenant configuration entirely, INCLUDING the
  // provider list. That's the break-glass path: a tenant that sets
  // authProviders to a method that can't deliver (magic link with no sending
  // route, say) would otherwise lock out the only people who can fix it.
  if (opts.superadminEmails.includes(email)) {
    return { allow: true, reason: 'superadmin' };
  }

  if (!isProviderEnabled(opts.config, opts.provider)) {
    return { allow: false, reason: 'provider-disabled' };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { tenantId: true, status: true },
  });

  // A disabled account is refused before anything else can re-admit it —
  // an admin who revokes access must not be overridden by a domain match.
  if (existing?.status === 'disabled') {
    return { allow: false, reason: 'disabled-account' };
  }

  // Provisioned for this tenant: invited by an admin, or an existing user.
  if (existing?.tenantId && (!opts.tenantId || existing.tenantId === opts.tenantId)) {
    return { allow: true, reason: 'provisioned' };
  }

  // Nobody may cross tenants: an account provisioned for tenant A can't
  // sign in on tenant B's subdomain even if B allowlists their domain.
  if (existing?.tenantId && opts.tenantId && existing.tenantId !== opts.tenantId) {
    return { allow: false, reason: 'not-invited' };
  }

  // Optional auto-join: anyone on an allowlisted domain gets an account on
  // first sign-in. Tenants that want invite-only turn this off.
  const autoJoin = opts.config.allowDomainAutoJoin !== false;
  if (autoJoin && opts.tenantId && opts.config.allowedDomains.includes(emailDomain(email))) {
    return { allow: true, reason: 'domain-auto-join' };
  }

  return { allow: false, reason: 'not-invited' };
}

/**
 * Query string for the sign-in page when a decision refuses access. Kept
 * deliberately coarse: the page must not reveal whether an address exists,
 * so every refusal that isn't a configuration error looks identical.
 */
export function signInErrorFor(decision: Extract<SignInDecision, { allow: false }>): string {
  switch (decision.reason) {
    case 'provider-disabled':
      return '/auth/signin?error=ProviderDisabled';
    case 'disabled-account':
    case 'not-invited':
    default:
      return '/auth/signin?error=AccessDenied';
  }
}
