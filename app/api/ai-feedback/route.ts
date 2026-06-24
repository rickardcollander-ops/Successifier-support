import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const {
      ticketId,
      aiResponse,
      finalResponse,
      rating,
      knowledgeUsed,
    } = body;

    // Get ticket details (scoped to this deployment's tenant)
    const tenant = await getTenant();
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, ...(tenant ? { tenantId: tenant.id } : {}) },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Determine if response was edited. Compare on collapsed whitespace so a
    // verbatim send that differs only by a trailing newline isn't recorded as
    // an edit — this row is the reports' authoritative "edited?" signal.
    const norm = (s: unknown) => (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim();
    const wasEdited = norm(aiResponse) !== norm(finalResponse);

    // Create feedback entry
    const feedback = await prisma.aIResponseFeedback.create({
      data: {
        tenantId: ticket.tenantId,
        ticketId,
        customerEmail: ticket.customerEmail,
        subject: ticket.subject,
        originalMessage: ticket.originalMessage,
        aiResponse,
        finalResponse,
        wasEdited,
        rating,
        contextUsed: ticket.contextData as any,
        knowledgeUsed: knowledgeUsed || [],
      },
    });

    return NextResponse.json({ success: true, feedback });
  } catch (error) {
    console.error('Error saving AI feedback:', error);
    return NextResponse.json(
      { error: 'Failed to save feedback' },
      { status: 500 }
    );
  }
}

// Get feedback for learning
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get('subject');
    const limit = parseInt(searchParams.get('limit') || '10');

    // Find tenant
    const tenant = await getTenant();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Get recent positive feedback for similar subjects
    const feedback = await prisma.aIResponseFeedback.findMany({
      where: {
        tenantId: tenant.id,
        rating: 'positive',
        ...(subject && {
          OR: [
            { subject: { contains: subject, mode: 'insensitive' } },
            { originalMessage: { contains: subject, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        originalMessage: true,
        aiResponse: true,
        finalResponse: true,
        wasEdited: true,
        knowledgeUsed: true,
      },
    });

    return NextResponse.json({ feedback });
  } catch (error) {
    console.error('Error fetching AI feedback:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feedback' },
      { status: 500 }
    );
  }
}
