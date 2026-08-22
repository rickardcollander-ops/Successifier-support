import { prisma } from '@/lib/db/client';
import { ResendService } from '@/lib/integrations/resend';
import { decryptCredentials } from '@/lib/integrations/credentials';
import type { ProductConfig } from '@/lib/products/types';

// Outgoing mail for the sign-in flow: magic links and invitations.
//
// Delivery goes through the TENANT's own Resend integration when they have
// one, so the mail comes from their brand and their sending domain. The
// platform env pair (AUTH_RESEND_KEY / AUTH_EMAIL_FROM) is the fallback for
// a customer who hasn't connected Resend yet — without either, sign-in mail
// simply can't be sent and we say so loudly rather than failing silently.

export class AuthEmailUnavailableError extends Error {
  constructor() {
    super(
      'No sending route for sign-in mail: connect the tenant’s Resend integration ' +
        'or set AUTH_RESEND_KEY (or RESEND_API_KEY) together with AUTH_EMAIL_FROM.',
    );
    this.name = 'AuthEmailUnavailableError';
  }
}

async function resolveSender(tenantId: string | null, config: ProductConfig): Promise<ResendService> {
  if (tenantId) {
    const integration = await prisma.integration.findFirst({
      where: { tenantId, type: 'resend', isActive: true },
    });
    if (integration) {
      const credentials = decryptCredentials(integration.credentials);
      if (credentials.apiKey && credentials.fromEmail) {
        return new ResendService(credentials.apiKey, credentials.fromEmail);
      }
    }
  }

  const apiKey = process.env.AUTH_RESEND_KEY || process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (apiKey && from) {
    return new ResendService(apiKey, `${config.fromName} <${from}>`);
  }

  throw new AuthEmailUnavailableError();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// One plain, unmistakably transactional template for both mails. Deliberately
// free of images and tracking: sign-in mail that lands in spam is a support
// team that can't work.
function layout(opts: {
  config: ProductConfig;
  heading: string;
  intro: string;
  buttonLabel: string;
  url: string;
  footer: string;
}): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">${escapeHtml(opts.heading)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#334155;">${escapeHtml(opts.intro)}</p>
      <a href="${escapeHtml(opts.url)}"
         style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:500;">
        ${escapeHtml(opts.buttonLabel)}
      </a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#64748b;">${escapeHtml(opts.footer)}</p>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;word-break:break-all;">${escapeHtml(opts.url)}</p>
    </div>
  </body>
</html>`;
}

/** The magic-link mail. `expiresMinutes` is stated so the recipient isn't surprised. */
export async function sendMagicLinkEmail(opts: {
  to: string;
  url: string;
  tenantId: string | null;
  config: ProductConfig;
  expiresMinutes: number;
}): Promise<void> {
  const sender = await resolveSender(opts.tenantId, opts.config);
  const english = opts.config.language === 'en';
  const brand = opts.config.displayName;

  const subject = english
    ? `Sign in to ${brand} Support`
    : `Logga in på ${brand} Support`;

  const html = layout({
    config: opts.config,
    heading: subject,
    intro: english
      ? `Click the button below to sign in. The link works once and expires in ${opts.expiresMinutes} minutes.`
      : `Klicka på knappen nedan för att logga in. Länken fungerar en gång och slutar gälla om ${opts.expiresMinutes} minuter.`,
    buttonLabel: english ? 'Sign in' : 'Logga in',
    url: opts.url,
    footer: english
      ? 'If you did not request this link you can ignore this email — nobody gets access without it.'
      : 'Om du inte har begärt den här länken kan du ignorera mejlet — ingen får åtkomst utan den.',
  });

  await sender.sendEmail(opts.to, subject, html);
}

/** The invitation mail an admin triggers from the user admin. */
export async function sendInviteEmail(opts: {
  to: string;
  signInUrl: string;
  invitedByEmail: string;
  tenantId: string | null;
  config: ProductConfig;
}): Promise<void> {
  const sender = await resolveSender(opts.tenantId, opts.config);
  const english = opts.config.language === 'en';
  const brand = opts.config.displayName;

  const subject = english
    ? `You have been invited to ${brand} Support`
    : `Du har blivit inbjuden till ${brand} Support`;

  const html = layout({
    config: opts.config,
    heading: subject,
    intro: english
      ? `${opts.invitedByEmail} has given you access to ${brand} Support. Sign in with the address this email was sent to.`
      : `${opts.invitedByEmail} har gett dig åtkomst till ${brand} Support. Logga in med adressen som det här mejlet skickades till.`,
    buttonLabel: english ? 'Go to sign-in' : 'Till inloggningen',
    url: opts.signInUrl,
    footer: english
      ? 'Only the invited address can use this access.'
      : 'Bara den inbjudna adressen kan använda åtkomsten.',
  });

  await sender.sendEmail(opts.to, subject, html);
}
