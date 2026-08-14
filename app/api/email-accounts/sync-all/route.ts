import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { google } from 'googleapis';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { upsertTicket } from '@/lib/services/deduplicator';
import { classifyTicket } from '@/lib/services/ticket-classifier';
import { logTicketEvent, TICKET_EVENT, EVENT_ACTOR } from '@/lib/services/ticket-events';
import { sanitizeInboundText } from '@/lib/services/sanitize';
import { sendConfirmationEmail } from '@/lib/services/confirmation-email';
import { getBlockedPatterns, isBlocked } from '@/lib/services/blocked-senders';
import { htmlToText, isHtml } from '@/lib/utils/html-to-text';
import { parseFramerForm } from '@/lib/services/inbound-forms';
import { getMessageAttachments } from '@/lib/integrations/gmail-attachments';
import { gmailOAuthClient } from '@/lib/integrations/gmail-account';

async function syncSingleAccount(account: {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}) {
  const oauth2Client = gmailOAuthClient(
    account,
    `${process.env.NEXTAUTH_URL}/api/auth/callback/google`
  );

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const tenant = await getTenant();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const integrations = await prisma.integration.findMany({
    where: {
      tenantId: tenant.id,
      isActive: true,
    },
  });
  const contextAggregator = new ContextAggregator();
  const blockedPatterns = await getBlockedPatterns(tenant.id);

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread in:inbox',
    maxResults: 10,
  });

  const messages = response.data.messages || [];
  let newTickets = 0;

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
      // RFC 2822 Message-Id is globally unique across all Gmail
      // inboxes that received the same mail. Gmail's per-account
      // message.id is NOT — so we use this for cross-account dedup
      // (see /root/.claude/plans/den-saken-som-flipprade-…).
      const rfcMessageIdRaw = getHeader('Message-Id') || getHeader('Message-ID');
      const rfcMessageId = rfcMessageIdRaw.trim().replace(/^<|>$/g, '');
      const senderRaw = replyTo || from;
      const emailMatch = senderRaw.match(/<([^>]+)>/);
      let customerEmail = emailMatch ? emailMatch[1] : senderRaw.trim();
      let customerName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();

      // Skip emails sent by the inbox account itself (e.g. support replies
      // that Gmail puts back in the inbox on shared/Workspace accounts).
      // Without this the sync would reopen a just-sent ticket to in_progress.
      if (customerEmail.toLowerCase() === account.email.toLowerCase()) {
        console.log(`[Email Sync] Skipping self-sent message ${message.id} from ${account.email}`);
        try {
          await gmail.users.messages.modify({
            userId: 'me',
            id: message.id!,
            requestBody: { removeLabelIds: ['UNREAD'] },
          });
        } catch {}
        continue;
      }

      // Block-list filter: drop the message silently (still mark read
      // so it disappears from the inbox) and skip ticket creation.
      if (isBlocked(customerEmail, blockedPatterns)) {
        console.log(`[Email Sync] Blocked sender ${customerEmail}, skipping message ${message.id}`);
        try {
          await gmail.users.messages.modify({
            userId: 'me',
            id: message.id!,
            requestBody: { removeLabelIds: ['UNREAD'] },
          });
        } catch (err) {
          console.error(`[Email Sync] Failed to mark blocked message read:`, err);
        }
        continue;
      }

      // Recursive function to extract all text content from nested parts
      function extractTextFromParts(parts: any[]): string {
        let text = '';
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            text += Buffer.from(part.body.data, 'base64').toString() + '\n\n';
          } else if (part.mimeType === 'text/html' && part.body?.data && !text) {
            // Fallback to HTML — strip tags so we store readable text.
            const html = Buffer.from(part.body.data, 'base64').toString();
            text += htmlToText(html) + '\n\n';
          }
          // Recursively check nested parts
          if (part.parts) {
            text += extractTextFromParts(part.parts);
          }
        }
        return text;
      }

      let body = '';
      if (msg.data.payload?.body?.data) {
        const raw = Buffer.from(msg.data.payload.body.data, 'base64').toString();
        // Non-multipart HTML emails arrive here — strip to plain text.
        body = isHtml(raw) ? htmlToText(raw) : raw;
      } else if (msg.data.payload?.parts) {
        body = extractTextFromParts(msg.data.payload.parts);
      }

      // Fetch all attachments (images + PDFs/docs) so support can view them
      // in-app instead of opening Gmail. The shared helper caps size/count.
      const attachments = await getMessageAttachments(gmail, message.id!, msg.data.payload || undefined);

      let gmailThreadId = msg.data.threadId || null;

      // Website contact-form notifications (e.g. Framer on serus.ai) come
      // from a no-reply address with the real customer in the body, and
      // every submission shares one Gmail thread. Rewrite the ticket to the
      // real customer and drop the shared thread id so different customers
      // don't collapse into one ticket — and so replies go to the customer,
      // not to the form's no-reply address.
      const formSubmission = parseFramerForm({ from, subject, body });
      if (formSubmission) {
        customerEmail = formSubmission.customerEmail;
        customerName = formSubmission.customerName ?? customerName;
        body = formSubmission.message || body;
        gmailThreadId = null;
      }

      // Cross-account dedup. The RFC 2822 Message-Id is preserved
      // across every Gmail inbox that received this email; the
      // per-account `message.id` below is not. Without this check the
      // second inbox sees a different Gmail ID for the same physical
      // mail and re-runs the status-promotion logic — which is what
      // flipped agent-closed tickets back to Öppna.
      if (rfcMessageId) {
        const seenByMessageId = await prisma.ticket.findFirst({
          where: {
            tenantId: tenant.id,
            originalMessage: { contains: `[Message-Id: ${rfcMessageId}]` },
          },
          select: { id: true },
        });
        if (seenByMessageId) {
          console.log(`[Email Sync] Skipping cross-account duplicate ${message.id} (Message-Id ${rfcMessageId}) for ${account.email}`);
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

      // Check if ticket already exists for this Gmail message ID. Atomic
      // dedup below also handles this, but a quick pre-check avoids
      // fetching context & attachments for messages we've already seen.
      const existingTicket = await prisma.ticket.findFirst({
        where: {
          tenantId: tenant.id,
          originalMessage: {
            contains: `[Gmail ID: ${message.id}]`,
          },
        },
      });

      if (existingTicket) {
        console.log(`[Email Sync] Skipping duplicate message ${message.id} for ${account.email}`);
        continue;
      }

      // Gmail thread-id match wins over the subject heuristic — if any
      // earlier message in this thread already became a ticket, merge.
      // Catches the reported case where replying to an autoresponder
      // produced a duplicate because the subject prefix changed.
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

      // Customer replies (Re:/Sv:/Fwd:/Fw:) should be appended to the
      // existing thread so a single conversation lives in one ticket.
      // We look up the prior ticket regardless of how old it is —
      // earlier we only matched within the dedup window, which caused
      // every reply more than 5 minutes after the original to spawn a
      // duplicate ticket.
      const subjectNormalized = subject.replace(/^(Re|Sv|Fwd|Fw):\s*/i, '').trim();
      const isReply = /^(Re|Sv|Fwd|Fw):/i.test(subject);

      // Prefer the Gmail thread-id match; fall back to subject heuristic
      // when no thread match is found (e.g. legacy tickets without the
      // marker).
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
        // A genuinely new customer message just arrived (the Gmail ID
        // pre-check above filtered out re-processed messages, so if
        // we got here the message is new). Whatever status the ticket
        // had — including closed/sent — it now needs an agent again:
        //   new          → in_progress (agent hasn't started yet)
        //   in_progress  → keep (already active)
        //   review       → keep (intentionally awaiting agent action)
        //   sent/closed  → in_progress (customer replied to resolved
        //                  ticket → reopen so the reply is visible
        //                  instead of disappearing into Stängda)
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

      if (attachments.length > 0) {
        contextData.attachments = attachments;
      }

      // Atomic create-or-merge under a Postgres advisory lock so two
      // parallel syncs can't both insert a fresh ticket for the same
      // inbound message. When threadParentId is set we always merge
      // into that ticket (even outside the dedup window) so follow-up
      // replies don't create duplicates.
      // Gmail's internalDate is the real arrival timestamp for the
      // message (UNIX millis as a string). Use it for createdAt so the
      // ticket list reflects the order in which customers actually sent
      // their mail, not the order in which sync happened to pick them up.
      const internalMs = msg.data.internalDate ? Number(msg.data.internalDate) : NaN;
      const receivedAt = Number.isFinite(internalMs) ? new Date(internalMs) : null;

      const { ticket, created, merged } = await upsertTicket({
        tenantId: tenant.id,
        customerEmail,
        customerName,
        subject,
        originalMessage: `[Gmail ID: ${message.id}]\n[Inbox account: ${account.email}]\n${rfcMessageId ? `[Message-Id: ${rfcMessageId}]\n` : ''}\n${sanitizeInboundText(body || 'No content')}`,
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
        newTickets += 1;

        // Fire-and-forget acknowledgement so the customer knows their
        // mail landed. Skipped for replies (already an active thread)
        // and for messages the system itself sent (same domain as the
        // inbox account) to avoid mail-loops.
        const inboxDomain = account.email.split('@')[1]?.toLowerCase();
        const senderDomain = customerEmail.split('@')[1]?.toLowerCase();
        const isSelfEmail = inboxDomain && senderDomain && inboxDomain === senderDomain;
        if (!isReply && !isSelfEmail) {
          sendConfirmationEmail({
            emailAccountId: account.id,
            toEmail: customerEmail,
            originalSubject: subject,
          }).catch((err) => console.error('[Email Sync] Confirmation send failed:', err));
        }

        // AI category for the reports' "vad kunderna frågar om" panel.
        // Separate after() so a classifier hiccup never touches the draft
        // generation. classifyTicket never throws; raw SQL so the write
        // doesn't bump updatedAt and reorder the ticket list.
        after(async () => {
          const category = await classifyTicket(subject, body || 'No content');
          if (category) {
            await prisma.$executeRaw`
              UPDATE "Ticket" SET "category" = ${category} WHERE id = ${ticket.id}
            `;
          }
        });

        // after() keeps the generation alive past the response on
        // serverless hosts; a bare promise would be frozen and lost.
        after(async () => {
          try {
            const { response: aiResponse, confidence } = await generateAIResponse(
              subject, body || 'No content', contextData, tenant.id, ticket.id, customerEmail, customerName || undefined
            );
            // Raw SQL so we don't bump updatedAt — AI generation is not
            // customer activity and should not reorder the ticket list.
            await prisma.$executeRaw`
              UPDATE "Ticket"
              SET "aiResponse" = ${aiResponse},
                  "aiConfidence" = ${confidence},
                  "contentRefreshedAt" = NOW()
              WHERE id = ${ticket.id}
            `;
          } catch (error) {
            console.error(error);
          }
        });
      } else {
        console.log(`[Email Sync] Merged message ${message.id} into ticket ${ticket.id}`);
        if (merged) {
          // A customer follow-up landed in an existing ticket. Regenerate
          // the draft from the FULL merged thread (ticket.originalMessage)
          // so the AI answers the latest message with the whole timeline
          // in view — previously the stale draft only covered the message
          // that originally created the ticket.
          after(async () => {
            try {
              const { response: aiResponse, confidence } = await generateAIResponse(
                ticket.subject, ticket.originalMessage, contextData, tenant.id, ticket.id, customerEmail, customerName || undefined
              );
              // Raw SQL so we don't bump updatedAt — AI generation is not
              // customer activity and should not reorder the ticket list.
              await prisma.$executeRaw`
                UPDATE "Ticket"
                SET "aiResponse" = ${aiResponse},
                    "aiConfidence" = ${confidence},
                    "contentRefreshedAt" = NOW()
                WHERE id = ${ticket.id}
              `;
            } catch (error) {
              console.error(error);
            }
          });
        }
      }

      await gmail.users.messages.modify({
        userId: 'me',
        id: message.id!,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });
    } catch (error) {
      console.error(`Error processing message ${message.id} for ${account.email}:`, error);
    }
  }

  await prisma.emailAccount.update({
    where: { id: account.id },
    data: { lastSyncAt: new Date() },
  });

  return { accountId: account.id, email: account.email, newTickets };
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Sync ALL active email accounts, not just the current user's
    const accounts = await prisma.emailAccount.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        accessToken: true,
        refreshToken: true,
      },
    });

    if (accounts.length === 0) {
      return NextResponse.json({ success: true, syncedAccounts: 0, totalNewTickets: 0, results: [] });
    }

    const results = [] as Array<{ accountId: string; email: string; newTickets: number; error?: string }>;

    for (const account of accounts) {
      try {
        const result = await syncSingleAccount(account);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          accountId: account.id,
          email: account.email,
          newTickets: 0,
          error: message,
        });
      }
    }

    const totalNewTickets = results.reduce((sum, r) => sum + r.newTickets, 0);

    return NextResponse.json({
      success: true,
      syncedAccounts: results.length,
      totalNewTickets,
      results,
    });
  } catch (error) {
    console.error('Error syncing all email accounts:', error);
    return NextResponse.json(
      { error: 'Failed to sync email accounts' },
      { status: 500 }
    );
  }
}
