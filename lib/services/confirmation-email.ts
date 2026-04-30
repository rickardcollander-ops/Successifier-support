import { google } from 'googleapis';
import { prisma } from '@/lib/db/client';

// Subject + body of the autoresponder customers receive when they email
// support and we open a brand-new ticket. Kept short and on-brand so it
// doesn't read like a marketing blast.
function buildConfirmationEmail(originalSubject: string) {
  const cleanSubject = originalSubject.replace(/^(Re|Sv|Fwd|Fw):\s*/i, '').trim();
  const subject = cleanSubject ? `Re: ${cleanSubject}` : 'Vi har tagit emot ditt mejl';
  const body = [
    'Hej!',
    '',
    'Tack för att du kontaktar Doldadress Kundtjänst. Vi har tagit emot ditt mejl och återkommer till dig så snart vi kan, vanligen inom 24 timmar på vardagar.',
    '',
    'Du behöver inte göra något mer just nu — vi hör av oss på den här adressen.',
    '',
    'Vänliga hälsningar,',
    'Doldadress Kundtjänst',
  ].join('\n');
  return { subject, body };
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
