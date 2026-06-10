import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { ResendService } from '@/lib/integrations/resend';
import { google } from 'googleapis';
import { auth } from '@/lib/auth';
import { applyAgentSignature } from '@/lib/constants';
import { gmailOAuthClient } from '@/lib/integrations/gmail-account';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { response: rawResponse, fromAccountId, recipientEmail } = body;

    if (!rawResponse) {
      return NextResponse.json(
        { error: 'Response text is required' },
        { status: 400 }
      );
    }

    // Capture which signed-in user clicked Send so we can credit them
    // in reports. Falls back to null when no session (e.g. API usage).
    let sentBy: string | null = null;
    try {
      const session = await auth();
      sentBy = session?.user?.name || session?.user?.email || null;
    } catch {
      sentBy = null;
    }

    // Inline images get appended after [INLINE_IMAGES] in the request
    // body — apply the agent signature only to the text portion so we
    // don't insert the sign-off in the middle of the HTML img markup.
    const hasInlineImages = rawResponse.includes('[INLINE_IMAGES]');
    const responseTextPart = hasInlineImages ? rawResponse.split('[INLINE_IMAGES]')[0] : rawResponse;
    const responseImagePart = hasInlineImages ? rawResponse.split('[INLINE_IMAGES]')[1] : '';
    const responseTextWithSig = applyAgentSignature(responseTextPart, sentBy);
    const response = hasInlineImages
      ? `${responseTextWithSig}[INLINE_IMAGES]${responseImagePart}`
      : responseTextWithSig;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
    });

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    let sentVia = 'unknown';

    // If a Gmail account is selected, send via Gmail
    if (fromAccountId) {
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: fromAccountId },
      });

      if (!emailAccount || !emailAccount.isActive) {
        return NextResponse.json(
          { error: 'Selected email account not found or inactive' },
          { status: 400 }
        );
      }

      const oauth2Client = gmailOAuthClient(emailAccount);

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Extract the Gmail thread id stored on the original ticket so the
      // outgoing message stays in the same conversation in Gmail. Without
      // this Gmail treated our replies as new threads, which made the
      // mails from kontakt@doldadress.se look disconnected.
      const threadMarker = ticket.originalMessage.match(/\[Gmail Thread: ([^\]]+)\]/);
      const gmailThreadId = threadMarker?.[1] || null;

      // The thread id is only valid in the inbox that originally
      // received the message. If support picks a different "Svara
      // från"-konto we must NOT pass it — otherwise Gmail returns
      // "Requested entity was not found" and the whole send fails.
      // We stamped the inbox account into originalMessage at sync time
      // as "[Inbox account: <email>]"; if that header is missing
      // (legacy tickets) we err on the side of caution and skip the
      // thread id.
      const inboxMarker = ticket.originalMessage.match(/\[Inbox account: ([^\]]+)\]/);
      const ticketInboxAccount = inboxMarker?.[1]?.trim().toLowerCase() || null;
      const sameInbox = ticketInboxAccount && ticketInboxAccount === emailAccount.email.toLowerCase();
      const safeThreadId = sameInbox ? gmailThreadId : null;

      // Don't prefix "Re:" if the subject already starts with one
      // (case-insensitive, also Swedish "Sv:") — otherwise outgoing
      // mails accumulated "Re: Re: Re:" prefixes.
      const subjectPrefixed = /^\s*(re|sv|fwd|fw)\s*:/i.test(ticket.subject)
        ? ticket.subject
        : `Re: ${ticket.subject}`;

      // RFC 2047 encoded-word for any header value containing non-ASCII
      // (e.g. å, ä, ö). Gmail's send API otherwise rejects the message
      // — that was Malin's "Mailet kunde inte skickas. Försök igen."
      // when the subject or display name contained Swedish letters.
      const encodeHeader = (value: string): string => {
        if (/^[\x20-\x7E]*$/.test(value)) return value;
        const b64 = Buffer.from(value, 'utf-8').toString('base64');
        return `=?UTF-8?B?${b64}?=`;
      };

      // Build a clean multipart/alternative message: plain text for
      // older clients, properly-styled HTML for everyone else. The old
      // format relied on `white-space: pre-wrap` which rendered the
      // greeting + signature as a single visually-glued block in some
      // clients. Now paragraphs become real <p> blocks.
      const hasImages = response.includes('[INLINE_IMAGES]');
      const textOnly = hasImages ? response.split('[INLINE_IMAGES]')[0] : response;
      const imageHtml = hasImages ? response.split('[INLINE_IMAGES]')[1] : '';
      const plainText = textOnly.replace(/\r?\n\s*\r?\n/g, '\n\n');
      const escapeHtml = (s: string) =>
        s.replace(/&/g, '&amp;')
         .replace(/</g, '&lt;')
         .replace(/>/g, '&gt;')
         .replace(/"/g, '&quot;')
         .replace(/'/g, '&#39;');
      const htmlParagraphs = plainText
        .trim()
        .split(/\r?\n\r?\n/)
        .map((para) => `<p style="margin:0 0 12px 0;">${escapeHtml(para).replace(/\r?\n/g, '<br/>')}</p>`)
        .join('\n');
      const htmlBody = [
        '<!DOCTYPE html>',
        '<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#222;">',
        `<div style="max-width:640px;">${htmlParagraphs}${imageHtml}</div>`,
        '</body></html>',
      ].join('');

      // Boundary must avoid characters that some MTAs treat specially.
      // Earlier we used a leading "=" which is the sentinel for
      // quoted-printable and was a likely cause of intermittent send
      // failures.
      const boundary = `dadrs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const fromValue = `${encodeHeader(product.fromName)} <${emailAccount.email}>`;
      const headers = [
        `From: ${fromValue}`,
        `To: ${recipientEmail || ticket.customerEmail}`,
        `Subject: ${encodeHeader(subjectPrefixed)}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ];
      const mimeBody = [
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        plainText,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        htmlBody,
        '',
        `--${boundary}--`,
        '',
      ].join('\r\n');
      const rawMessage = headers.join('\r\n') + '\r\n' + mimeBody;

      const encodedMessage = Buffer.from(rawMessage, 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // Pass the Gmail thread id so the customer sees our reply
      // inside the original conversation instead of as a new thread.
      const sendRequest: any = { raw: encodedMessage };
      if (safeThreadId) sendRequest.threadId = safeThreadId;

      const isNotFoundError = (err: any): boolean => {
        const code = err?.code || err?.response?.status;
        if (code === 404) return true;
        const msg = (err?.errors?.[0]?.message || err?.response?.data?.error?.message || err?.message || '').toLowerCase();
        return msg.includes('not found') || msg.includes('requested entity');
      };

      try {
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: sendRequest,
        });
      } catch (firstError: any) {
        // Gmail can still reject the threadId — for example when the
        // thread has been deleted or the inbox marker was missing on
        // older tickets and we guessed wrong. Retry once without the
        // threadId so the customer at least gets the reply.
        if (sendRequest.threadId && isNotFoundError(firstError)) {
          console.warn('[Send] Gmail rejected threadId, retrying without it:', firstError?.message);
          delete sendRequest.threadId;
          try {
            await gmail.users.messages.send({
              userId: 'me',
              requestBody: sendRequest,
            });
          } catch (retryError: any) {
            const detail =
              retryError?.errors?.[0]?.message ||
              retryError?.response?.data?.error?.message ||
              retryError?.message ||
              'Okänt Gmail-fel';
            console.error('[Send] Gmail send retry failed:', detail, retryError);
            return NextResponse.json(
              { error: `Gmail kunde inte skicka mejlet: ${detail}` },
              { status: 502 }
            );
          }
        } else {
          const detail =
            firstError?.errors?.[0]?.message ||
            firstError?.response?.data?.error?.message ||
            firstError?.message ||
            'Okänt Gmail-fel';
          console.error('[Send] Gmail send failed:', detail, firstError);
          return NextResponse.json(
            { error: `Gmail kunde inte skicka mejlet: ${detail}` },
            { status: 502 }
          );
        }
      }

      sentVia = emailAccount.email;
    } else {
      // Fallback: send via Resend
      const resendIntegration = await prisma.integration.findFirst({
        where: {
          tenantId: ticket.tenantId,
          type: 'resend',
          isActive: true,
        },
      });

      if (!resendIntegration) {
        return NextResponse.json(
          { error: 'No email account selected and Resend integration not configured' },
          { status: 400 }
        );
      }

      const resendService = new ResendService(
        (resendIntegration.credentials as any).apiKey as string,
        (resendIntegration.credentials as any).fromEmail as string
      );

      // Handle inline images for Resend too
      const hasImagesResend = response.includes('[INLINE_IMAGES]');
      const textPartResend = hasImagesResend ? response.split('[INLINE_IMAGES]')[0] : response;
      const imageHtmlResend = hasImagesResend ? response.split('[INLINE_IMAGES]')[1] : '';
      const htmlContent = hasImagesResend
        ? `<div style="font-family:sans-serif;font-size:14px;white-space:pre-wrap;">${textPartResend.replace(/\n/g, '<br/>')}</div>${imageHtmlResend}`
        : `<div style="font-family:sans-serif;font-size:14px;white-space:pre-wrap;">${response.replace(/\n/g, '<br/>')}</div>`;

      try {
        await resendService.sendEmail(
          recipientEmail || ticket.customerEmail,
          `Re: ${ticket.subject}`,
          htmlContent
        );
      } catch (resendError: any) {
        const detail = resendError?.message || 'Okänt Resend-fel';
        console.error('[Send] Resend send failed:', detail, resendError);
        return NextResponse.json(
          { error: `Resend kunde inte skicka mejlet: ${detail}` },
          { status: 502 }
        );
      }

      sentVia = (resendIntegration.credentials as any).fromEmail || 'resend';
    }

    // Append the sent reply to originalMessage so the full conversation
    // thread is preserved and visible in the ticket detail view.
    const sentTimestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
    const agentLabel = sentBy ? ` av ${sentBy}` : '';
    const supportSeparator = `\n\n---\n[Support-svar ${sentTimestamp}${agentLabel}]\n`;
    const responseBodyOnly = response.split('[INLINE_IMAGES]')[0].trim();

    const updatedTicket = await prisma.ticket.update({
      where: { id },
      data: {
        finalResponse: response,
        originalMessage: ticket.originalMessage + supportSeparator + responseBodyOnly,
        status: 'sent',
        sentAt: new Date(),
        sentBy: sentBy,
      },
    });

    // Learning system: Save sent response as knowledge base article
    // This helps AI learn from actual responses sent to customers
    try {
      const existingKB = await prisma.knowledgeBase.findFirst({
        where: {
          tenantId: ticket.tenantId,
          title: {
            contains: ticket.subject.substring(0, 50),
          },
          category: 'Lärande från skickade svar',
        },
      });

      if (!existingKB) {
        await prisma.knowledgeBase.create({
          data: {
            tenantId: ticket.tenantId,
            title: `${ticket.subject.substring(0, 150)}`,
            content: `# ${ticket.subject}

## Kundfråga
${ticket.originalMessage}

## Skickat Svar (Verifierat)
${response}

## Metadata
- Skickat: ${new Date().toISOString()}
- Kund: ${ticket.customerEmail}
- Status: ${ticket.status}
${(ticket.contextData as any)?.billecta ? `- Billecta-kontext: Ja (${(ticket.contextData as any).billecta.invoices?.length || 0} fakturor)` : ''}

Detta svar har skickats till en riktig kund och är verifierat korrekt.`,
            category: 'Lärande från skickade svar',
            tags: ['verified-response', 'customer-sent', 'learning', ...ticket.subject.toLowerCase().split(' ').slice(0, 3)],
            isActive: true,
          },
        });
      }
    } catch (error) {
      console.error('Failed to create learning KB article:', error);
      // Don't fail the send if KB creation fails
    }

    return NextResponse.json({ ...updatedTicket, sentVia });
  } catch (error: any) {
    console.error('Error sending response:', error);
    const detail = error?.message || 'Okänt fel';
    return NextResponse.json(
      { error: `Kunde inte skicka svaret: ${detail}` },
      { status: 500 }
    );
  }
}
