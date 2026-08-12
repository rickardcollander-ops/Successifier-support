import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { requireApiAuth } from '@/lib/api-auth';
import { findScopedTicket } from '@/lib/db/scoped';
import { rateLimit, clientIp } from '@/lib/rate-limit';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  // Each call costs real money (LLM tokens) — cap bursts per client.
  const limit = rateLimit(`generate:${clientIp(request.headers)}`, { limit: 20, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const { id } = await params;
    let step = 'fetch-ticket';

    const ticket = await findScopedTicket(id);

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
    // The generator runs on Anthropic (see lib/services/ai-generator.ts).
    // This used to gate on OPENAI_API_KEY — a leftover from the OpenAI era
    // that made every manual "Generera AI" fail on deployments without a
    // legacy OpenAI key (e.g. Serus), while the background sync drafts
    // (which never had the check) kept working.
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'AI generation is not configured (ANTHROPIC_API_KEY missing)' },
        { status: 500 }
      );
    }

    step = 'ai-generate';
    // Use the unified AI generator which includes KB, learning examples, and previous tickets
    const { response: aiResponse, confidence, knowledgeUsed } = await generateAIResponse(
      ticket.subject,
      ticket.originalMessage,
      context,
      ticket.tenantId,
      ticket.id,
      ticket.customerEmail,
      ticket.customerName ?? undefined
    );

    step = 'save-to-db';
    // Raw SQL so we don't bump updatedAt — AI generation is not customer
    // activity and should not reorder the ticket list. The manual
    // "Generera AI" button regenerates a draft without implying new
    // customer action, so position in the sorted list should stay stable.
    await prisma.$executeRaw`
      UPDATE "Ticket"
      SET "aiResponse" = ${aiResponse},
          "aiConfidence" = ${confidence},
          "contextData" = ${JSON.stringify(context)}::jsonb,
          "contentRefreshedAt" = NOW()
      WHERE id = ${id}
    `;

    // Return the full updated ticket for the frontend to merge into state.
    const updatedTicket = await prisma.ticket.findUnique({ where: { id } });
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
