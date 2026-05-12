import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/client';
import { google } from 'googleapis';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { upsertTicket } from '@/lib/services/deduplicator';
import { sendConfirmationEmail } from '@/lib/services/confirmation-email';
import { getBlockedPatterns, isBlocked } from '@/lib/services/blocked-senders';

async function syncSingleAccount(account: {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL}/api/auth/callback/google`
  );

  oauth2Client.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
  });

  // Persist refreshed tokens so future syncs don't fail
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
      console.error(`[Email Sync] Failed to persist refreshed tokens for ${account.email}:`, err);
    }
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'doldadress' } });

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
      const senderRaw = replyTo || from;
      const emailMatch = senderRaw.match(/<([^>]+)>/);
      const customerEmail = emailMatch ? emailMatch[1] : senderRaw.trim();
      const customerName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();

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
            // Fallback to HTML if no plain text found
            text += Buffer.from(part.body.data, 'base64').toString() + '\n\n';
          }
          // Recursively check nested parts
          if (part.parts) {
            text += extractTextFromParts(part.parts);
          }
        }
        return text;
      }

      // Extract image attachments from nested parts
      interface ImageAttachment {
        filename: string;
        mimeType: string;
        attachmentId: string;
        size: number;
      }
      function extractImageAttachments(parts: any[]): ImageAttachment[] {
        const images: ImageAttachment[] = [];
        for (const part of parts) {
          if (part.mimeType?.startsWith('image/') && part.body?.attachmentId) {
            images.push({
              filename: part.filename || 'image',
              mimeType: part.mimeType,
              attachmentId: part.body.attachmentId,
              size: part.body.size || 0,
            });
          }
          if (part.parts) {
            images.push(...extractImageAttachments(part.parts));
          }
        }
        return images;
      }

      let body = '';
      if (msg.data.payload?.body?.data) {
        body = Buffer.from(msg.data.payload.body.data, 'base64').toString();
      } else if (msg.data.payload?.parts) {
        body = extractTextFromParts(msg.data.payload.parts);
      }

      // Fetch image attachments (limit to 5, max 2MB each)
      const imageAttachmentMeta = msg.data.payload?.parts
        ? extractImageAttachments(msg.data.payload.parts)
        : [];
      const attachments: Array<{ filename: string; mimeType: string; dataUrl: string }> = [];
      for (const img of imageAttachmentMeta.slice(0, 5)) {
        if (img.size > 2 * 1024 * 1024) continue; // skip > 2MB
        try {
          const attachmentRes = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: message.id!,
            id: img.attachmentId,
          });
          if (attachmentRes.data.data) {
            const base64Data = attachmentRes.data.data.replace(/-/g, '+').replace(/_/g, '/');
            attachments.push({
              filename: img.filename,
              mimeType: img.mimeType,
              dataUrl: `data:${img.mimeType};base64,${base64Data}`,
            });
          }
        } catch (err) {
          console.error(`[Email Sync] Failed to fetch attachment ${img.filename}:`, err);
        }
      }

      const gmailThreadId = msg.data.threadId || null;

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
        // Move "new" tickets that the agent hasn't picked up yet into
        // Öppna so it's clear there's been customer activity. Don't
        // ever flip closed/sent/review tickets back open — those
        // statuses represent agent decisions; the new reply gets
        // appended to the thread but the resolved status stays put.
        if (threadParentStatus === 'new') {
          await prisma.ticket.update({
            where: { id: threadParentId },
            data: { status: 'in_progress' },
          });
          console.log(`[Email Sync] Customer message merged into ticket ${threadParentId} (moved Nytt → Öppna)`);
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
      const { ticket, created } = await upsertTicket({
        tenantId: tenant.id,
        customerEmail,
        customerName,
        subject,
        originalMessage: `[Gmail ID: ${message.id}]\n[Inbox account: ${account.email}]\n\n${body || 'No content'}`,
        status: isReply ? 'in_progress' : 'new',
        priority: 'normal',
        contextData,
        gmailMessageId: message.id,
        gmailThreadId,
        threadParentTicketId: threadParentId,
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

        generateAIResponse(subject, body || 'No content', contextData, tenant.id, ticket.id, customerEmail, customerName || undefined)
          .then(async ({ response: aiResponse, confidence }) => {
            await prisma.ticket.update({
              where: { id: ticket.id },
              data: {
                aiResponse,
                aiConfidence: confidence,
              },
            });
          })
          .catch(console.error);
      } else {
        console.log(`[Email Sync] Merged message ${message.id} into ticket ${ticket.id}`);
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
