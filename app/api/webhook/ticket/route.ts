import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenantId } from '@/lib/products/tenant';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { upsertTicket } from '@/lib/services/deduplicator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, name, subject, message, priority } = body;

    if (!email || !subject || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: email, subject, message' },
        { status: 400 }
      );
    }

    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const integrations = await prisma.integration.findMany({
      where: {
        tenantId,
        isActive: true,
      },
    });

    const contextAggregator = new ContextAggregator();
    const context = await contextAggregator.gatherContext(email, integrations as any);

    const subjectNormalized = subject.replace(/^(Re|Sv|Fwd|Fw):\s*/i, '').trim();
    const isReply = /^(Re|Sv|Fwd|Fw):/i.test(subject);
    if (isReply) {
      const priorTicket = await prisma.ticket.findFirst({
        where: {
          tenantId,
          customerEmail: email,
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
      customerEmail: email,
      customerName: name,
      subject,
      originalMessage: message,
      priority: priority || 'normal',
      status: isReply ? 'in_progress' : 'new',
      contextData: context,
    });

    return NextResponse.json({
      success: true,
      ticketId: ticket.id,
      merged: !created,
    });
  } catch (error) {
    console.error('Error creating ticket from webhook:', error);
    return NextResponse.json(
      { error: 'Failed to create ticket' },
      { status: 500 }
    );
  }
}
