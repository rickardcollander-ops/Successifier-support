import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/db/client';
import { invalidateTenantCache } from '@/lib/products/tenant';

// PLATFORM billing webhook — OUR Stripe account, where customers pay for
// their Successifier subscription. Entirely separate from the per-tenant
// Stripe integration (Integration rows) used to look up THEIR customers.
//
// Setup: point a Stripe webhook at /api/platform/stripe-webhook with the
// events below, and set PLATFORM_STRIPE_SECRET_KEY +
// PLATFORM_STRIPE_WEBHOOK_SECRET. Checkout links should carry the tenant's
// id (or subdomain) as client_reference_id, and optionally metadata.plan.
//
// Auth: Stripe signature verification (constructEvent) — rejects anything
// not signed with our webhook secret.

export const dynamic = 'force-dynamic';

type BillingPatch = {
  plan?: string;
  billingStatus?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string | null;
};

function statusFromSubscription(status: Stripe.Subscription.Status): string {
  switch (status) {
    case 'active':
    case 'trialing': // Stripe-managed trial — paid signup, treat as active
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'unpaid':
    case 'paused':
      return 'suspended';
    default:
      return 'past_due';
  }
}

async function findTenant(opts: { customerId?: string | null; reference?: string | null }) {
  if (opts.customerId) {
    const byCustomer = await prisma.tenant.findUnique({
      where: { stripeCustomerId: opts.customerId },
    });
    if (byCustomer) return byCustomer;
  }
  if (opts.reference) {
    return prisma.tenant.findFirst({
      where: { OR: [{ id: opts.reference }, { subdomain: opts.reference }] },
    });
  }
  return null;
}

export async function POST(request: NextRequest) {
  const secretKey = process.env.PLATFORM_STRIPE_SECRET_KEY;
  const webhookSecret = process.env.PLATFORM_STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: 'Platform billing not configured' }, { status: 503 });
  }

  const stripe = new Stripe(secretKey);
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let tenantId: string | null = null;
  let patch: BillingPatch | null = null;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const tenant = await findTenant({
        customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
        reference: session.client_reference_id,
      });
      if (tenant) {
        tenantId = tenant.id;
        patch = {
          billingStatus: 'active',
          stripeCustomerId:
            typeof session.customer === 'string' ? session.customer : session.customer?.id,
          stripeSubscriptionId:
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription?.id ?? null,
          ...(session.metadata?.plan ? { plan: session.metadata.plan } : { plan: 'starter' }),
        };
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const tenant = await findTenant({
        customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
        reference: sub.metadata?.tenant ?? null,
      });
      if (tenant) {
        tenantId = tenant.id;
        patch =
          event.type === 'customer.subscription.deleted'
            ? { billingStatus: 'canceled', stripeSubscriptionId: null }
            : {
                billingStatus: statusFromSubscription(sub.status),
                stripeSubscriptionId: sub.id,
                ...(sub.metadata?.plan ? { plan: sub.metadata.plan } : {}),
              };
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const tenant = await findTenant({
        customerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
      });
      // Only downgrade tenants that are currently fine — never resurrect a
      // canceled/suspended tenant to past_due.
      if (tenant && ['active', 'trialing'].includes(tenant.billingStatus)) {
        tenantId = tenant.id;
        patch = { billingStatus: 'past_due' };
      }
      break;
    }
    default:
      // Unhandled event type — acknowledge so Stripe stops retrying.
      break;
  }

  if (tenantId && patch) {
    await prisma.tenant.update({ where: { id: tenantId }, data: patch });
    invalidateTenantCache();
    console.log(`[platform-billing] ${event.type} → tenant ${tenantId}:`, patch);
  }

  return NextResponse.json({ received: true });
}
