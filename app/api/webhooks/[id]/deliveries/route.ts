import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireSettingsAdmin } from '@/lib/api-auth';
import { findScopedWebhook } from '@/lib/db/scoped';

// The delivery log for one endpoint: what we sent, what came back. This is
// what a customer debugs their receiver against while building.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    const endpoint = await findScopedWebhook(id);
    if (!endpoint) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        event: true,
        status: true,
        statusCode: true,
        attempts: true,
        error: true,
        durationMs: true,
        payload: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ deliveries });
  } catch (error) {
    console.error('Error fetching webhook deliveries:', error);
    return NextResponse.json({ error: 'Failed to fetch deliveries' }, { status: 500 });
  }
}
