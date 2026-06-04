import Stripe from 'stripe';

export class StripeService {
  private stripe: Stripe;

  constructor(apiKey: string) {
    this.stripe = new Stripe(apiKey, {
      apiVersion: '2026-01-28.clover',
    });
  }

  // Retry a Stripe call with exponential backoff. The first request during
  // a cold start frequently times out or returns nothing, which is why the
  // Stripe card used to show up only after a second AI regeneration.
  private async withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i === attempts - 1) break;
        await new Promise((r) => setTimeout(r, 250 * 2 ** i));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Stripe ${label} failed`);
  }

  async getCustomerByEmail(email: string) {
    try {
      const customers = await this.withRetry('customers.list', () =>
        this.stripe.customers.list({ email, limit: 1 })
      );
      return customers.data[0] || null;
    } catch (error) {
      console.error('Error fetching Stripe customer:', error);
      return null;
    }
  }

  async getCustomerContext(email: string) {
    try {
      const customer = await this.getCustomerByEmail(email);
      if (!customer) return null;

      // Use allSettled so a Stripe restricted key (rk_…) that lacks scope for
      // one resource (e.g. no Charges read) still returns whatever it CAN
      // read, instead of wiping out all Stripe context. The customer lookup
      // above already requires Customers read — that's the minimum scope.
      const results = await Promise.allSettled([
        this.withRetry('subscriptions.list', () =>
          this.stripe.subscriptions.list({ customer: customer.id, limit: 10 })
        ),
        this.withRetry('invoices.list', () =>
          this.stripe.invoices.list({ customer: customer.id, limit: 10 })
        ),
        this.withRetry('charges.list', () =>
          this.stripe.charges.list({ customer: customer.id, limit: 10 })
        ),
      ]);
      const pick = (i: number, label: string): any[] => {
        const r = results[i];
        if (r.status === 'fulfilled') return (r.value as any).data;
        console.warn(`Stripe ${label} unavailable (missing scope on restricted key?):`, (r.reason as any)?.message || r.reason);
        return [];
      };
      const subscriptionsData = pick(0, 'subscriptions');
      const invoicesData = pick(1, 'invoices');
      const chargesData = pick(2, 'charges');

      const subscriptionsList = subscriptionsData.map((sub: any) => {
          // As of API version 2025-03-31.basil (we run 2026-01-28.clover),
          // current_period_end was removed from the Subscription object and
          // moved onto each subscription item. Read it from the item first
          // and fall back to the legacy top-level field for safety.
          const firstItem = sub.items.data[0] as any;
          const currentPeriodEnd =
            firstItem?.current_period_end ?? (sub as any).current_period_end ?? null;
          return {
          id: sub.id,
          status: sub.status,
          currentPeriodEnd,
          canceledAt: (sub as any).canceled_at || null,
          endedAt: (sub as any).ended_at || null,
          cancelAt: (sub as any).cancel_at || null,
          items: sub.items.data.map((item: any) => ({
            price: item.price.unit_amount,
            product: item.price.product,
          })),
        };
        });

      const hasActiveSubscription = subscriptionsList.some(
        sub => sub.status === 'active' || sub.status === 'trialing'
      );
      const hasAnyCanceled = subscriptionsList.some(
        sub => sub.status === 'canceled'
      );
      const accountClosed = subscriptionsList.length > 0 && !hasActiveSubscription && hasAnyCanceled;

      return {
        customerId: customer.id,
        accountClosed,
        subscriptions: subscriptionsList,
        invoices: invoicesData.map((inv: any) => ({
          id: inv.id,
          status: inv.status,
          amount: inv.amount_due,
          dueDate: inv.due_date,
          paid: inv.status === 'paid',
        })),
        charges: chargesData.map((charge: any) => ({
          id: charge.id,
          amount: charge.amount,
          status: charge.status,
          created: charge.created,
        })),
      };
    } catch (error) {
      console.error('Error fetching Stripe context:', error);
      return null;
    }
  }
}
