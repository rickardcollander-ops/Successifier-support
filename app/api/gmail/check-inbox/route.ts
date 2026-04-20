import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { GmailService } from '@/lib/integrations/gmail';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { upsertTicket } from '@/lib/services/deduplicator';

export async function POST(request: NextRequest) {
  try {
    const tenantId = 'doldadress';

    // Get Gmail integration
    const gmailIntegration = await prisma.integration.findFirst({
      where: {
        tenantId,
        type: 'gmail',
        isActive: true,
      },
    });

    if (!gmailIntegration) {
      return NextResponse.json(
        { error: 'Gmail integration not configured' },
        { status: 400 }
      );
    }

    const creds = gmailIntegration.credentials as Record<string, string>;
    const gmailService = new GmailService({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
    });

    // Fetch unread emails
    const emails = await gmailService.getUnreadEmails(10);
    const createdTickets = [];

    // Get all integrations for context
    const integrations = await prisma.integration.findMany({
      where: {
        tenantId,
        isActive: true,
      },
    });

    const contextAggregator = new ContextAggregator();

    for (const email of emails) {
      const context = await contextAggregator.gatherContext(email.from, integrations as any);

      const subjectNormalized = email.subject.replace(/^(Re|Sv|Fwd|Fw):\s*/i, '').trim();
      const isReply = /^(Re|Sv|Fwd|Fw):/i.test(email.subject);
      if (isReply) {
        const priorTicket = await prisma.ticket.findFirst({
          where: {
            tenantId,
            customerEmail: email.from,
            status: { notIn: ['duplicate', 'archived'] },
            subject: {
              contains: subjectNormalized.substring(0, 50),
            },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (priorTicket && priorTicket.status !== 'in_progress') {
          await prisma.ticket.update({
            where: { id: priorTicket.id },
            data: { status: 'in_progress' },
          });
        }
      }

      const { ticket, created } = await upsertTicket({
        tenantId,
        customerEmail: email.from,
        customerName: email.name,
        subject: email.subject,
        originalMessage: email.body,
        status: isReply ? 'in_progress' : 'new',
        priority: 'normal',
        contextData: context,
        gmailMessageId: email.id,
      });

      if (created) {
        createdTickets.push(ticket);
      }

      await gmailService.markAsRead(email.id);
    }

    return NextResponse.json({
      success: true,
      ticketsCreated: createdTickets.length,
      tickets: createdTickets,
    });
  } catch (error) {
    console.error('Error checking Gmail inbox:', error);
    return NextResponse.json(
      { error: 'Failed to check inbox' },
      { status: 500 }
    );
  }
}
