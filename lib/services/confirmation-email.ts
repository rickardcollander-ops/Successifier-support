import { google } from 'googleapis';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';

// Subject + body of the autoresponder customers receive when they email
// support and we open a brand-new ticket. Kept short and on-brand so it
// doesn't read like a marketing blast.
function buildConfirmationEmail(originalSubject: string) {
  const cleanSubject = originalSubject.replace(/^(Re|Sv|Fwd|Fw):\s*/i, '').trim();
  const subject = cleanSubject ? `Re: ${cleanSubject}` : 'Vi har tagit emot ditt mejl';
  const { greeting, bodyLines, signoff } = product.confirmation;
  const body = [
    greeting,
    '',
    // Each body paragraph followed by a blank line, then the sign-off.
    ...bodyLines.flatMap((line) => [line, '']),
    signoff,
  ].join('\n');
  return { subject, body };
}

// Addresses that obviously don't accept incoming mail. Sending an
// autoresponder to these used to flood our own inbox with bounces from
// mailer-daemon (e.g. our confirmation to no-reply@billecta.com).
const UNDELIVERABLE_LOCAL_PARTS = new Set([
  'no-reply',
  'noreply',
  'do-not-reply',
  'donotreply',
  'mailer-daemon',
  'postmaster',
  'bounce',
  'bounces',
  'notifications',
  'notification',
]);

export function isUndeliverableAddress(email: string): boolean {
  if (!email) return true;
  const lower = email.toLowerCase().trim();
  const local = lower.split('@')[0] || '';
  if (UNDELIVERABLE_LOCAL_PARTS.has(local)) return true;
  // Common "no-reply" variants we don't want to enumerate exactly.
  if (/^no[\-_\.]?reply/.test(local)) return true;
  if (/^do[\-_\.]?not[\-_\.]?reply/.test(local)) return true;
  return false;
}

// Send a "we received your email" autoresponder from the same Gmail account
// that the customer emailed. Returns silently on failure — we never want a
// failing autoresponder to block ticket creation.
export async function sendConfirmationEmail(opts: {
  emailAccountId: string;
  toEmail: string;
  originalSubject: string;
}): Promise<void> {
  try {
    // Don't autoreply to no-reply@/postmaster@/mailer-daemon@ etc. —
    // these either bounce immediately or generate noise notifications
    // that come back into our own inbox.
    if (isUndeliverableAddress(opts.toEmail)) {
      console.log(`[Confirmation] Skipping autoresponder to undeliverable address ${opts.toEmail}`);
      return;
    }
    const account = await prisma.emailAccount.findUnique({
      where: { id: opts.emailAccountId },
    });
    if (!account || !account.isActive) return;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );

    oauth2Client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
    });

    oauth2Client.on('tokens', async (tokens) => {
      try {
        const updateData: { accessToken?: string; refreshToken?: string } = {};
        if (tokens.access_token) updateData.accessToken = tokens.access_token;
        if (tokens.refresh_token) updateData.refreshToken = tokens.refresh_token;
        if (Object.keys(updateData).length > 0) {
          await prisma.emailAccount.update({
            where: { id: account.id },
            data: updateData,
          });
        }
      } catch (err) {
        console.error('[Confirmation] Failed to persist refreshed tokens:', err);
      }
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const { subject, body } = buildConfirmationEmail(opts.originalSubject);

    const rawMessage = [
      `From: ${account.email}`,
      `To: ${opts.toEmail}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      // RFC 3834 hints so smart inboxes don't auto-reply back to us.
      'Auto-Submitted: auto-replied',
      'X-Auto-Response-Suppress: All',
      '',
      body,
    ].join('\r\n');

    const encoded = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });
    console.log(`[Confirmation] Sent receipt to ${opts.toEmail} via ${account.email}`);
  } catch (error) {
    console.error('[Confirmation] Failed to send confirmation email:', error);
  }
}
