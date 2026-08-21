import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { google } from 'googleapis';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { upsertTicket } from '@/lib/services/deduplicator';
import { logTicketEvent, TICKET_EVENT, EVENT_ACTOR } from '@/lib/services/ticket-events';
import { sanitizeInboundText } from '@/lib/services/sanitize';
import { sendConfirmationEmail } from '@/lib/services/confirmation-email';
import { getBlockedPatterns, isBlocked } from '@/lib/services/blocked-senders';
import { htmlToText, isHtml } from '@/lib/utils/html-to-text';
import { parseFramerForm } from '@/lib/services/inbound-forms';
import { getMessageAttachments } from '@/lib/integrations/gmail-attachments';
import { gmailOAuthClient } from '@/lib/integrations/gmail-account';
import { saveAiDraft } from '@/lib/services/ai-draft';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    const session = await auth();
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const emailAccount = await prisma.emailAccount.findFirst({
      where: {
        id: accountId,
        userId: user.id,
      },
    });

    if (!emailAccount) {
      return NextResponse.json({ error: 'Email account not found' }, { status: 404 });
    }

    if (!emailAccount.isActive) {
      return NextResponse.json({ error: 'Email account is inactive' }, { status: 400 });
    }

    // Set up Gmail API
    const oauth2Client = gmailOAuthClient(
      emailAccount,
      `${process.env.NEXTAUTH_URL}/api/auth/callback/google`
    );

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch unread emails
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 10,
    });

    const messages = response.data.messages || [];
    let newTickets = 0;

    // Find tenant
    const tenant = await getTenant();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const integrations = await prisma.integration.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true,
      },
    });
    const contextAggregator = new ContextAggregator();
    const blockedPatterns = await getBlockedPatterns(tenant.id);

    for (const message of messages) {
      try {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
          format: 'full',
        });

        const headers = msg.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
        const subject = getHeader('Subject') || 'No Subject';
        const replyTo = getHeader('Reply-To');
        const from = getHeader('From');
        // RFC 2822 Message-Id for cross-account dedup. See sync-all
        // for the explanation; Gmail's per-account message.id alone
        // doesn't dedupe across two inboxes that received the same
        // physical mail.
        const rfcMessageIdRaw = getHeader('Message-Id') || getHeader('Message-ID');
        const rfcMessageId = rfcMessageIdRaw.trim().replace(/^<|>$/g, '');
        const senderRaw = replyTo || from;
        const emailMatch = senderRaw.match(/<([^>]+)>/);
        let customerEmail = emailMatch ? emailMatch[1] : senderRaw.trim();
        let customerName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();

        // Skip emails sent by the inbox account itself to prevent support
        // replies (which Gmail can surface as unread in shared inboxes) from
        // reopening a just-sent ticket back to in_progress.
        if (customerEmail.toLowerCase() === emailAccount.email.toLowerCase()) {
          console.log(`[Email Sync] Skipping self-sent message ${message.id} from ${emailAccount.email}`);
          try {
            await gmail.users.messages.modify({
              userId: 'me',
              id: message.id!,
              requestBody: { removeLabelIds: ['UNREAD'] },
            });
          } catch {}
          continue;
        }

        if (isBlocked(customerEmail, blockedPatterns)) {
          console.log(`[Email Sync] Blocked sender ${customerEmail}, skipping ${message.id}`);
          try {
            await gmail.users.messages.modify({
              userId: 'me',
              id: message.id!,
              requestBody: { removeLabelIds: ['UNREAD'] },
            });
          } catch (err) {
            console.error('[Email Sync] Failed to mark blocked message read:', err);
          }
          continue;
        }

        // Get email body — prefer plain text; fall back to HTML stripped to text
        let body = '';
        if (msg.data.payload?.body?.data) {
          const raw = Buffer.from(msg.data.payload.body.data, 'base64').toString();
          body = isHtml(raw) ? htmlToText(raw) : raw;
        } else if (msg.data.payload?.parts) {
          const textPart = msg.data.payload.parts.find(p => p.mimeType === 'text/plain');
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64').toString();
          } else {
            // No plain-text part — try HTML and convert to text
            const htmlPart = msg.data.payload.parts.find(p => p.mimeType === 'text/html');
            if (htmlPart?.body?.data) {
              const html = Buffer.from(htmlPart.body.data, 'base64').toString();
              body = htmlToText(html);
            }
          }
        }

        let gmailThreadId = msg.data.threadId || null;

        // Website contact-form notifications (e.g. Framer on serus.ai) come
        // from a no-reply address with the real customer in the body, and
        // every submission shares one Gmail thread. Rewrite the ticket to
        // the real customer and drop the shared thread id so different
        // customers don't collapse into one ticket — and so replies go to
        // the customer, not to the form's no-reply address.
        const formSubmission = parseFramerForm({ from, subject, body });
        if (formSubmission) {
          customerEmail = formSubmission.customerEmail;
          customerName = formSubmission.customerName ?? customerName;
          body = formSubmission.message || body;
          gmailThreadId = null;
        }

        // Cross-account dedup via RFC 2822 Message-Id. See sync-all
        // for full reasoning — this stops the same physical email
        // (received in multiple inboxes) from triggering status
        // promotion twice and flipping closed/sent tickets back to
        // in_progress.
        if (rfcMessageId) {
          const seenByMessageId = await prisma.ticket.findFirst({
            where: {
              tenantId: tenant.id,
              originalMessage: { contains: `[Message-Id: ${rfcMessageId}]` },
            },
            select: { id: true },
          });
          if (seenByMessageId) {
            console.log(`[Email Sync] Skipping cross-account duplicate ${message.id} (Message-Id ${rfcMessageId})`);
            try {
              await gmail.users.messages.modify({
                userId: 'me',
                id: message.id!,
                requestBody: { removeLabelIds: ['UNREAD'] },
              });
            } catch (err) {
              console.error('[Email Sync] Failed to mark cross-account dup read:', err);
            }
            continue;
          }
        }

        // Skip if this exact Gmail message is already a ticket (pre-check
        // before fetching context; upsertTicket also handles this race).
        const existingTicket = await prisma.ticket.findFirst({
          where: {
            tenantId: tenant.id,
            originalMessage: { contains: `[Gmail ID: ${message.id}]` },
          },
        });
        if (existingTicket) {
          continue;
        }

        let threadIdMatchTicket: { id: string; status: string } | null = null;
        if (gmailThreadId) {
          threadIdMatchTicket = await prisma.ticket.findFirst({
            where: {
              tenantId: tenant.id,
              originalMessage: { contains: `[Gmail Thread: ${gmailThreadId}]` },
              status: { notIn: ['archived', 'duplicate'] },
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, status: true },
          });
        }

        const contextData = await contextAggregator.gatherContext(customerEmail, integrations as any);

        // Fetch attachments (images + PDFs/docs) so they show up in-app.
        // Previously this route extracted none, so customers' images were
        // invisible whenever the per-account sync ran.
        const attachments = await getMessageAttachments(gmail, message.id!, msg.data.payload || undefined);
        if (attachments.length > 0) {
          (contextData as any).attachments = attachments;
        }

        const subjectNormalized = subject.replace(/^(Re|Sv|Fwd|Fw):\s*/i, '').trim();
        const isReply = /^(Re|Sv|Fwd|Fw):/i.test(subject);

        let threadParentId: string | null = threadIdMatchTicket?.id || null;
        let threadParentStatus: string | null = threadIdMatchTicket?.status || null;

        if (!threadParentId && isReply && subjectNormalized) {
          const priorTicket = await prisma.ticket.findFirst({
            where: {
              tenantId: tenant.id,
              customerEmail,
              status: { notIn: ['duplicate', 'archived'] },
              subject: {
                contains: subjectNormalized.substring(0, 50),
              },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (priorTicket) {
            threadParentId = priorTicket.id;
            threadParentStatus = priorTicket.status;
          }
        }

        if (threadParentId && threadParentStatus) {
          // The Gmail ID pre-check filtered out re-processed messages,
          // so reaching here means a genuinely new customer message.
          // Reopen sent/closed tickets so the reply doesn't vanish
          // into Stängda; keep review/in_progress untouched.
          if (threadParentStatus === 'new' || threadParentStatus === 'sent' || threadParentStatus === 'closed') {
            await prisma.ticket.update({
              where: { id: threadParentId },
              data: { status: 'in_progress' },
            });
            await logTicketEvent(prisma, {
              tenantId: tenant.id,
              ticketId: threadParentId,
              type: TICKET_EVENT.statusChanged,
              actor: EVENT_ACTOR.gmailSync,
              fromValue: threadParentStatus,
              toValue: 'in_progress',
            });
            console.log(`[Email Sync] New customer message in thread ${threadParentId}: ${threadParentStatus} → in_progress`);
          } else {
            console.log(`[Email Sync] Customer message merged into ticket ${threadParentId} (status preserved: ${threadParentStatus})`);
          }
        }

        const internalMs = msg.data.internalDate ? Number(msg.data.internalDate) : NaN;
        const receivedAt = Number.isFinite(internalMs) ? new Date(internalMs) : null;

        const { ticket, created, merged } = await upsertTicket({
          tenantId: tenant.id,
          customerEmail,
          customerName,
          subject,
          originalMessage: `[Gmail ID: ${message.id}]\n${rfcMessageId ? `[Message-Id: ${rfcMessageId}]\n` : ''}\n${sanitizeInboundText(body || 'No content')}`,
          status: isReply ? 'in_progress' : 'new',
          priority: 'normal',
          contextData,
          gmailMessageId: message.id,
          gmailThreadId,
          rfcMessageId: rfcMessageId || null,
          threadParentTicketId: threadParentId,
          receivedAt,
        });

        if (created) {
          newTickets++;

          const inboxDomain = emailAccount.email.split('@')[1]?.toLowerCase();
          const senderDomain = customerEmail.split('@')[1]?.toLowerCase();
          const isSelfEmail = inboxDomain && senderDomain && inboxDomain === senderDomain;
          if (!isReply && !isSelfEmail) {
            sendConfirmationEmail({
              emailAccountId: emailAccount.id,
              toEmail: customerEmail,
              originalSubject: subject,
            }).catch((err) => console.error('[Email Sync] Confirmation send failed:', err));
          }

          // after() keeps the generation alive past the response on
          // serverless hosts; a bare promise would be frozen and lost.
          after(async () => {
            try {
              const { response, confidence } = await generateAIResponse(
                subject, body || 'No content', contextData, tenant.id, ticket.id, customerEmail, customerName || undefined
              );
              await saveAiDraft({ ticketId: ticket.id, aiResponse: response, confidence });
            } catch (error) {
              console.error(error);
            }
          });
        } else if (merged) {
          // A customer follow-up landed in an existing ticket. Regenerate
          // the draft from the FULL merged thread (ticket.originalMessage)
          // so the AI answers the latest message with the whole timeline
          // in view — previously the stale draft only covered the message
          // that originally created the ticket.
          after(async () => {
            try {
              const { response, confidence } = await generateAIResponse(
                ticket.subject, ticket.originalMessage, contextData, tenant.id, ticket.id, customerEmail, customerName || undefined
              );
              await saveAiDraft({ ticketId: ticket.id, aiResponse: response, confidence });
            } catch (error) {
              console.error(error);
            }
          });
        }

        await gmail.users.messages.modify({
          userId: 'me',
          id: message.id!,
          requestBody: {
            removeLabelIds: ['UNREAD'],
          },
        });
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error);
      }
    }

    // Update last sync time
    await prisma.emailAccount.update({
      where: { id: emailAccount.id },
      data: { lastSyncAt: new Date() },
    });

    return NextResponse.json({ success: true, newTickets });
  } catch (error) {
    console.error('Error syncing email account:', error);
    return NextResponse.json(
      { error: 'Failed to sync email account' },
      { status: 500 }
    );
  }
}
