import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { AIService } from '@/lib/services/ai-service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
    });

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    const integrations = await prisma.integration.findMany({
      where: {
        tenantId: ticket.tenantId,
        isActive: true,
      },
    });

    const knowledgeBase = await prisma.knowledgeBase.findMany({
      where: {
        tenantId: ticket.tenantId,
        isActive: true,
      },
    });

    const contextAggregator = new ContextAggregator();
    const context = await contextAggregator.gatherContext(
      ticket.customerEmail,
      integrations as any
    );

    const contextFormatted = contextAggregator.formatContextForAI(context);

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const aiService = new AIService(openaiApiKey);
    const aiResponse = await aiService.generateResponse(
      ticket.originalMessage,
      context,
      contextFormatted,
      knowledgeBase
    );

    const updatedTicket = await prisma.ticket.update({
      where: { id },
      data: {
        aiResponse,
        contextData: context,
        status: 'review',
      },
    });

    return NextResponse.json(updatedTicket);
  } catch (error) {
    console.error('Error generating AI response:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to generate AI response', details: message },
      { status: 500 }
    );
  }
}
