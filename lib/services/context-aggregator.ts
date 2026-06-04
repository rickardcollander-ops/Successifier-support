import { StripeService } from '../integrations/stripe';
import { BillectaService } from '../integrations/billecta';
import { RetoolService } from '../integrations/retool';
import { ResendService } from '../integrations/resend';
import { GmailService } from '../integrations/gmail';
import { ClerkService } from '../integrations/clerk';
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
                credentials.workflowUrl || credentials.workspaceUrl
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

            case 'clerk':
              const clerkService = new ClerkService(credentials.secretKey);
              const clerkData = await clerkService.getCustomerContext(normalizedEmail);
              if (clerkData) context.clerk = clerkData;
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

    if (context.clerk) {
      const c = context.clerk;
      formatted += '=== Clerk (Användarkonto) ===\n';
      formatted += `Konto finns (user-id: ${c.userId})\n`;
      if (c.name) formatted += `Namn: ${c.name}\n`;
      if (c.username) formatted += `Användarnamn: ${c.username}\n`;
      if (c.primaryEmail) formatted += `Primär e-post: ${c.primaryEmail} (${c.emailVerified ? 'verifierad' : 'EJ verifierad'})\n`;
      if (c.emails && c.emails.length > 1) {
        formatted += `Alla e-postadresser: ${c.emails.map(e => `${e.email}${e.verified ? '' : ' (ej verifierad)'}`).join(', ')}\n`;
      }
      if (c.phone) formatted += `Telefon: ${c.phone} (${c.phoneVerified ? 'verifierad' : 'ej verifierad'})\n`;
      if (c.createdAt) formatted += `Konto skapat: ${new Date(c.createdAt).toLocaleDateString('sv-SE')}\n`;
      if (c.lastSignInAt) formatted += `Senaste inloggning: ${new Date(c.lastSignInAt).toLocaleDateString('sv-SE')}\n`;
      if (c.lastActiveAt) formatted += `Senast aktiv: ${new Date(c.lastActiveAt).toLocaleDateString('sv-SE')}\n`;
      // Login methods — key for "I can't log in" tickets.
      const methods: string[] = [];
      if (c.passwordEnabled) methods.push('lösenord');
      if (c.socialAccounts && c.socialAccounts.length > 0) methods.push(...c.socialAccounts);
      formatted += `Inloggningsmetoder: ${methods.length ? methods.join(', ') : 'okänt'}\n`;
      formatted += `Tvåfaktor (2FA): ${c.twoFactorEnabled ? 'på' : 'av'}\n`;
      if (c.plan) formatted += `Plan: ${c.plan}\n`;
      if (c.organizations && c.organizations.length > 0) {
        formatted += `Organisationer: ${c.organizations.map(o => `${o.name}${o.role ? ` (${o.role})` : ''}`).join(', ')}\n`;
      }
      if (c.metadata) formatted += `Metadata: ${JSON.stringify(c.metadata)}\n`;
      if (c.banned) formatted += `⚠️ Kontot är BANNAT\n`;
      if (c.locked) {
        formatted += `⚠️ Kontot är LÅST`;
        if (c.lockoutExpiresInSeconds) formatted += ` (låsning släpper om ~${Math.round(c.lockoutExpiresInSeconds / 60)} min)`;
        formatted += '\n';
      }
      formatted += '\n';
    }

    if (context.retool && context.retool.data) {
      formatted += '=== Retool (Kunddata) ===\n';
      const data = context.retool.data;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const [key, value] of Object.entries(data)) {
          const printable =
            value !== null && typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
          formatted += `${key}: ${printable}\n`;
        }
      } else {
        formatted += `${JSON.stringify(data, null, 2)}\n`;
      }
      formatted += '\n';
    }

    return formatted;
  }
}
