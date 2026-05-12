import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/client';
import { google } from 'googleapis';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { upsertTicket } from '@/lib/services/deduplicator';
import { sendConfirmationEmail } from '@/lib/services/confirmation-email';
import { getBlockedPatterns, isBlocked } from '@/lib/services/blocked-senders';

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
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.NEXTAUTH_URL}/api/auth/callback/google`
    );

    oauth2Client.setCredentials({
      access_token: emailAccount.accessToken,
      refresh_token: emailAccount.refreshToken,
    });

    // Persist refreshed tokens so future syncs don't fail
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
        console.error(`[Email Sync] Failed to persist refreshed tokens:`, err);
      }
    });

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
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: 'doldadress' },
    });

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
        const senderRaw = replyTo || from;
        const emailMatch = senderRaw.match(/<([^>]+)>/);
        const customerEmail = emailMatch ? emailMatch[1] : senderRaw.trim();
        const customerName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();

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

        // Get email body
        let body = '';
        if (msg.data.payload?.body?.data) {
          body = Buffer.from(msg.data.payload.body.data, 'base64').toString();
        } else if (msg.data.payload?.parts) {
          const textPart = msg.data.payload.parts.find(p => p.mimeType === 'text/plain');
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64').toString();
          }
        }

        const gmailThreadId = msg.data.threadId || null;

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

        const { ticket, created } = await upsertTicket({
          tenantId: tenant.id,
          customerEmail,
          customerName,
          subject,
          originalMessage: `[Gmail ID: ${message.id}]\n\n${body || 'No content'}`,
          status: isReply ? 'in_progress' : 'new',
          priority: 'normal',
          contextData,
          gmailMessageId: message.id,
          gmailThreadId,
          threadParentTicketId: threadParentId,
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

          generateAIResponse(subject, body || 'No content', contextData, tenant.id, ticket.id, customerEmail, customerName || undefined)
            .then(async ({ response, confidence }) => {
              await prisma.ticket.update({
                where: { id: ticket.id },
                data: {
                  aiResponse: response,
                  aiConfidence: confidence,
                },
              });
            })
            .catch(console.error);
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
