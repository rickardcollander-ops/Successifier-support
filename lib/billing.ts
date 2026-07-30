import type { Tenant } from '@prisma/client';

// Platform billing rules: whether a tenant may use the agent app and API.
// This is OUR subscription state for the customer — separate from the
// tenant's own Stripe integration (which looks up THEIR end customers).
//
// Blocking policy:
//   - trialing: allowed until trialEndsAt has passed (no date = open trial).
//   - active:   allowed.
//   - past_due: allowed (grace period, surfaced as a warning banner) —
//               Stripe retries; suspension is an explicit operator action
//               or a subscription-deleted webhook.
//   - canceled/suspended: blocked.
// The public help center intentionally stays up for blocked tenants — it is
// read-only content and taking a customer's help pages down is a harsher
// step than locking the agent app.

export type BillingBlockReason = 'trial_expired' | 'canceled' | 'suspended';

export interface BillingState {
  /** May agents/API use the product right now? */
  active: boolean;
  blockedReason?: BillingBlockReason;
  /** Show a non-blocking payment warning in the app chrome. */
  warning?: 'past_due' | 'trial_ending';
  plan: string;
  status: string;
  trialEndsAt: string | null;
}

const TRIAL_ENDING_SOON_MS = 3 * 24 * 60 * 60 * 1000;

export function billingState(tenant: Tenant): BillingState {
  const base = {
    plan: tenant.plan,
    status: tenant.billingStatus,
    trialEndsAt: tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null,
  };
  switch (tenant.billingStatus) {
    case 'suspended':
      return { ...base, active: false, blockedReason: 'suspended' };
    case 'canceled':
      return { ...base, active: false, blockedReason: 'canceled' };
    case 'past_due':
      return { ...base, active: true, warning: 'past_due' };
    case 'trialing': {
      if (tenant.trialEndsAt) {
        const remaining = tenant.trialEndsAt.getTime() - Date.now();
        if (remaining <= 0) return { ...base, active: false, blockedReason: 'trial_expired' };
        if (remaining <= TRIAL_ENDING_SOON_MS) return { ...base, active: true, warning: 'trial_ending' };
      }
      return { ...base, active: true };
    }
    case 'active':
    default:
      return { ...base, active: true };
  }
}

export const DEFAULT_TRIAL_DAYS = 14;

export function defaultTrialEnd(from = new Date()): Date {
  return new Date(from.getTime() + DEFAULT_TRIAL_DAYS * 24 * 60 * 60 * 1000);
}
