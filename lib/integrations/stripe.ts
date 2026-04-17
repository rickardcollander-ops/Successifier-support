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

      const [subscriptions, invoices, charges] = await Promise.all([
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

      const subscriptionsList = subscriptions.data.map(sub => ({
          id: sub.id,
          status: sub.status,
          currentPeriodEnd: (sub as any).current_period_end,
          canceledAt: (sub as any).canceled_at || null,
          endedAt: (sub as any).ended_at || null,
          cancelAt: (sub as any).cancel_at || null,
          items: sub.items.data.map(item => ({
            price: item.price.unit_amount,
            product: item.price.product,
          })),
        }));

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
        invoices: invoices.data.map(inv => ({
          id: inv.id,
          status: inv.status,
          amount: inv.amount_due,
          dueDate: inv.due_date,
          paid: inv.status === 'paid',
        })),
        charges: charges.data.map(charge => ({
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
