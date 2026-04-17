import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/client';
import { google } from 'googleapis';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { mergeIfDuplicate } from '@/lib/services/deduplicator';

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

      // Check if ticket already exists for this Gmail message ID
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

      // Try to merge this email into a recent ticket from the same sender
      // with the same subject (within the dedup window). If merged, skip
      // creating a new ticket entirely.
      const merge = await mergeIfDuplicate({
        tenantId: tenant.id,
        customerEmail,
        subject,
        body: `[Inbox account: ${account.email}]\n\n${body || 'No content'}`,
        gmailMessageId: message.id,
      });

      if (merge.merged) {
        console.log(`[Email Sync] Merged message ${message.id} into ticket ${merge.mergedIntoTicketId}`);
        // Still mark as read so Gmail stops surfacing it.
        await gmail.users.messages.modify({
          userId: 'me',
          id: message.id!,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
        continue;
      }

      const contextData = await contextAggregator.gatherContext(customerEmail, integrations as any);

      // Check if this is a customer reply. If the subject starts with
      // Re:/Sv:/Fwd:/Fw: we treat it as a reply — the new ticket lands in
      // Öppna (in_progress) instead of Nytt. We also try to find and
      // reopen any matching prior ticket from the same customer so the
      // conversation thread stays linked.
      const subjectNormalized = subject.replace(/^(Re|Sv|Fwd|Fw):\s*/i, '').trim();
      const isReply = /^(Re|Sv|Fwd|Fw):/i.test(subject);
      if (isReply) {
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

        if (priorTicket && priorTicket.status !== 'in_progress') {
          // Reopen the original ticket by setting it to in_progress (Öppna)
          await prisma.ticket.update({
            where: { id: priorTicket.id },
            data: { status: 'in_progress' },
          });
          console.log(`[Email Sync] Customer reply detected, reopened ticket ${priorTicket.id} to Öppna`);
        }
      }

      // Add attachments to context data
      if (attachments.length > 0) {
        contextData.attachments = attachments;
      }

      const ticket = await prisma.ticket.create({
        data: {
          tenantId: tenant.id,
          customerEmail,
          customerName,
          subject,
          originalMessage: `[Gmail ID: ${message.id}]\n[Inbox account: ${account.email}]\n\n${body || 'No content'}`,
          status: isReply ? 'in_progress' : 'new',
          priority: 'normal',
          contextData,
        },
      });

      newTickets += 1;

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
