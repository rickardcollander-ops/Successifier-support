import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { ContextAggregator } from '@/lib/services/context-aggregator';

// Re-fetch customer context (Stripe, Billecta, Resend, Retool) for a single
// ticket and persist the refreshed data. Called when support opens a
// ticket so the integration cards show up even when the original sync
// fetched nothing — without forcing support to regenerate the AI reply.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const integrations = await prisma.integration.findMany({
      where: { tenantId: ticket.tenantId, isActive: true },
    });

    const aggregator = new ContextAggregator();
    const fresh = await aggregator.gatherContext(ticket.customerEmail, integrations as any);

    // Preserve attachments that were stored during email import — they
    // live in contextData but aren't re-fetched by the aggregator.
    const existing = (ticket.contextData as Record<string, any> | null) ?? {};
    const merged: Record<string, any> = { ...fresh };
    if (existing.attachments) {
      merged.attachments = existing.attachments;
    }

    const updated = await prisma.ticket.update({
      where: { id },
      data: { contextData: merged },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error refreshing ticket context:', error);
    return NextResponse.json(
      { error: 'Failed to refresh context' },
      { status: 500 }
    );
  }
}
