import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { generateAIResponse } from '@/lib/services/ai-generator';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let step = 'fetch-ticket';

    const ticket = await prisma.ticket.findUnique({
      where: { id },
    });

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    step = 'fetch-integrations';
    const integrations = await prisma.integration.findMany({
      where: {
        tenantId: ticket.tenantId,
        isActive: true,
      },
    });

    step = 'gather-context';
    const contextAggregator = new ContextAggregator();
    const context = await contextAggregator.gatherContext(
      ticket.customerEmail,
      integrations as any
    );

    step = 'check-api-key';
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    step = 'openai-generate';
    // Use the unified AI generator which includes KB, learning examples, and previous tickets
    const { response: aiResponse, confidence } = await generateAIResponse(
      ticket.subject,
      ticket.originalMessage,
      context,
      ticket.tenantId,
      ticket.id,
      ticket.customerEmail,
      ticket.customerName ?? undefined
    );

    step = 'save-to-db';
    const updatedTicket = await prisma.ticket.update({
      where: { id },
      data: {
        aiResponse,
        aiConfidence: confidence,
        contextData: context,
        status: 'review',
      },
    });

    return NextResponse.json(updatedTicket);
  } catch (error) {
    console.error('Error generating AI response:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { error: 'Failed to generate AI response', details: message, stack },
      { status: 500 }
    );
  }
}
