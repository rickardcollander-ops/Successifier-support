import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { ResendService } from '@/lib/integrations/resend';
import { google } from 'googleapis';
import { auth } from '@/lib/auth';
import { applyAgentSignature } from '@/lib/constants';

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

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );

      oauth2Client.setCredentials({
        access_token: emailAccount.accessToken,
        refresh_token: emailAccount.refreshToken,
      });

      // Persist refreshed tokens so future requests don't fail
      oauth2Client.on('tokens', async (tokens) => {
        try {
          const updateData: { accessToken?: string; refreshToken?: string } = {};
          if (tokens.access_token) updateData.accessToken = tokens.access_token;
          if (tokens.refresh_token) updateData.refreshToken = tokens.refresh_token;
          if (Object.keys(updateData).length > 0) {
            await prisma.emailAccount.update({
              where: { id: emailAccount.id },
              data: updateData,
            });
          }
        } catch (err) {
          console.error('[Send] Failed to persist refreshed tokens:', err);
        }
      });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Extract the Gmail thread id stored on the original ticket so the
      // outgoing message stays in the same conversation in Gmail. Without
      // this Gmail treated our replies as new threads, which made the
      // mails from kontakt@doldadress.se look disconnected.
      const threadMarker = ticket.originalMessage.match(/\[Gmail Thread: ([^\]]+)\]/);
      const gmailThreadId = threadMarker?.[1] || null;

      // Don't prefix "Re:" if the subject already starts with one
      // (case-insensitive, also Swedish "Sv:") — otherwise outgoing
      // mails accumulated "Re: Re: Re:" prefixes.
      const subjectPrefixed = /^\s*(re|sv|fwd|fw)\s*:/i.test(ticket.subject)
        ? ticket.subject
        : `Re: ${ticket.subject}`;

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

      const boundary = `=_dadrs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const headers = [
        `From: Doldadress Kundtjänst <${emailAccount.email}>`,
        `To: ${recipientEmail || ticket.customerEmail}`,
        `Subject: ${subjectPrefixed}`,
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

      const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // Pass the Gmail thread id so the customer sees our reply
      // inside the original conversation instead of as a new thread.
      const sendRequest: any = { raw: encodedMessage };
      if (gmailThreadId) sendRequest.threadId = gmailThreadId;

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: sendRequest,
      });

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

      await resendService.sendEmail(
        recipientEmail || ticket.customerEmail,
        `Re: ${ticket.subject}`,
        htmlContent
      );

      sentVia = (resendIntegration.credentials as any).fromEmail || 'resend';
    }

    const updatedTicket = await prisma.ticket.update({
      where: { id },
      data: {
        finalResponse: response,
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
  } catch (error) {
    console.error('Error sending response:', error);
    return NextResponse.json(
      { error: 'Failed to send response' },
      { status: 500 }
    );
  }
}
