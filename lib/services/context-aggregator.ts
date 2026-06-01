import { StripeService } from '../integrations/stripe';
import { BillectaService } from '../integrations/billecta';
import { RetoolService } from '../integrations/retool';
import { ResendService } from '../integrations/resend';
import { GmailService } from '../integrations/gmail';
import type { Integration, TicketContext } from '../types';
import { decryptJSON, isEncrypted } from '../crypto';

export class ContextAggregator {
  private decryptCredentials(integration: Integration): any {
    try {
      const credentialsStr = typeof integration.credentials === 'string'
        ? integration.credentials
        : JSON.stringify(integration.credentials);
      
      // Check if encrypted, if so decrypt
      if (isEncrypted(credentialsStr)) {
        return decryptJSON(credentialsStr);
      }
      
      return integration.credentials;
    } catch (error) {
      console.error(`Failed to decrypt credentials for ${integration.type}:`, error);
      return integration.credentials; // Fallback to raw credentials
    }
  }

  async gatherContext(
    customerEmail: string,
    integrations: Integration[]
  ): Promise<TicketContext> {
    const context: TicketContext = {};
    const normalizedEmail = customerEmail.trim().toLowerCase();

    const promises = integrations
      .filter(i => i.isActive)
      .map(async (integration) => {
        try {
          const credentials = this.decryptCredentials(integration);
          
          switch (integration.type) {
            case 'stripe':
              const stripeService = new StripeService(credentials.apiKey);
              const stripeData = await stripeService.getCustomerContext(normalizedEmail);
              if (stripeData) context.stripe = stripeData;
              break;

            case 'billecta':
              const billectaService = new BillectaService(
                credentials.apiKey,
                credentials.creditorPublicId
              );
              const billectaData = await billectaService.getCustomerContext(normalizedEmail);
              if (billectaData) context.billecta = billectaData;
              break;

            case 'retool':
              const retoolService = new RetoolService(
                credentials.apiKey,
                credentials.workspaceUrl
              );
              const retoolData = await retoolService.getCustomerContext(normalizedEmail);
              if (retoolData) context.retool = retoolData;
              break;

            case 'resend':
              const resendService = new ResendService(
                credentials.apiKey,
                credentials.fromEmail
              );
              const resendData = await resendService.getCustomerContext(normalizedEmail);
              if (resendData) context.resend = resendData;
              break;

            case 'gmail':
              const gmailService = new GmailService({
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
                refreshToken: credentials.refreshToken,
              });
              const gmailData = await gmailService.getCustomerContext(normalizedEmail);
              if (gmailData) context.gmail = gmailData;
              break;
          }
        } catch (error) {
          console.error(`Error gathering context from ${integration.type}:`, error);
        }
      });

    await Promise.all(promises);
    return context;
  }

  formatContextForAI(context: TicketContext): string {
    let formatted = 'Customer Context:\n\n';

    if (context.stripe) {
      formatted += '=== Stripe ===\n';
      formatted += `Customer ID: ${context.stripe.customerId}\n`;
      if (context.stripe.accountClosed) {
        formatted += `⚠️ KONTO AVSLUTAT - Alla prenumerationer är avslutade\n`;
      }
      formatted += `Active Subscriptions: ${context.stripe.subscriptions?.length || 0}\n`;
      if (context.stripe.subscriptions && context.stripe.subscriptions.length > 0) {
        formatted += 'Prenumerationer:\n';
        context.stripe.subscriptions.forEach(sub => {
          formatted += `  - Status: ${sub.status}`;
          if (sub.currentPeriodEnd) formatted += `, Period slutar: ${new Date(sub.currentPeriodEnd * 1000).toLocaleDateString('sv-SE')}`;
          // canceledAt is when cancellation was requested, not when the
          // subscription ends. Label it as such and always show the actual
          // end date (cancelAt/endedAt) so the year isn't read off the
          // earlier request date.
          if (sub.canceledAt) formatted += `, Uppsägning begärd: ${new Date(sub.canceledAt * 1000).toLocaleDateString('sv-SE')}`;
          if (sub.endedAt) formatted += `, Upphörd: ${new Date(sub.endedAt * 1000).toLocaleDateString('sv-SE')}`;
          else if (sub.cancelAt) formatted += `, Upphör: ${new Date(sub.cancelAt * 1000).toLocaleDateString('sv-SE')}`;
          formatted += '\n';
        });
      }
      formatted += `Total Invoices: ${context.stripe.invoices?.length || 0}\n`;
      const unpaidInvoices = context.stripe.invoices?.filter(inv => !inv.paid) || [];
      if (unpaidInvoices.length > 0) {
        formatted += `Unpaid Invoices: ${unpaidInvoices.length}\n`;
      }
      formatted += '\n';
    }

    if (context.billecta) {
      formatted += '=== Billecta ===\n';
      if (context.billecta.debtorStatus) {
        formatted += `Gäldenärstatus: ${context.billecta.debtorStatus}\n`;
      }
      formatted += `Total Invoices: ${context.billecta.invoices?.length || 0}\n`;
      const unpaidBillecta = context.billecta.invoices?.filter(inv => !inv.isPaid) || [];
      if (unpaidBillecta.length > 0) {
        formatted += `Unpaid Invoices: ${unpaidBillecta.length}\n`;
        unpaidBillecta.forEach(inv => {
          formatted += `  - Invoice #${inv.number}: ${inv.amount} (Due: ${inv.dueDate})${inv.deliveryMethod ? ` [${inv.deliveryMethod}]` : ''}\n`;
        });
      }
      formatted += '\n';
    }

    if (context.resend) {
      formatted += '=== Email History ===\n';
      formatted += `Previous emails: ${context.resend.emailsSent || 0}\n`;
      if (context.resend.recentEmails && context.resend.recentEmails.length > 0) {
        formatted += 'Recent emails:\n';
        context.resend.recentEmails.slice(0, 5).forEach((email: any) => {
          formatted += `  - ${email.subject} (${new Date(email.createdAt).toLocaleDateString()})\n`;
        });
      }
      formatted += '\n';
    }

    return formatted;
  }
}
