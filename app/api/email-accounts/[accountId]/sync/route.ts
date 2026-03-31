import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/client';
import { google } from 'googleapis';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { ContextAggregator } from '@/lib/services/context-aggregator';

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

        const contextData = await contextAggregator.gatherContext(customerEmail, integrations as any);

        // Create ticket
        const ticket = await prisma.ticket.create({
          data: {
            tenantId: tenant.id,
            customerEmail,
            customerName,
            subject,
            originalMessage: body || 'No content',
            status: 'new',
            priority: 'normal',
            contextData,
          },
        });

        newTickets++;

        // Generate AI response in background
        generateAIResponse(subject, body || 'No content', contextData, tenant.id)
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

        // Mark as read
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
