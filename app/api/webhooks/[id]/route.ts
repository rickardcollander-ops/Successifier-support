import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireSettingsAdmin } from '@/lib/api-auth';
import { findScopedWebhook } from '@/lib/db/scoped';
import { encrypt } from '@/lib/crypto';
import { generateWebhookSecret } from '@/lib/webhooks/signature';
import { normalizeSubscription } from '@/lib/webhooks/events';
import { validateWebhookUrlResolved } from '@/lib/webhooks/url';

const PUBLIC_SELECT = {
  id: true,
  url: true,
  description: true,
  events: true,
  isActive: true,
  lastDeliveryAt: true,
  lastStatusCode: true,
  lastError: true,
  consecutiveFailures: true,
  autoDisabledAt: true,
  createdAt: true,
} as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    const existing = await findScopedWebhook(id);
    if (!existing) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if ('url' in body) {
      const url = await validateWebhookUrlResolved(body.url);
      if (!url.ok) return NextResponse.json({ error: url.error }, { status: 400 });
      data.url = url.url;
    }

    if ('events' in body) {
      const subscription = normalizeSubscription(body.events);
      if (!subscription.ok) {
        return NextResponse.json(
          { error: `Unknown event type: ${subscription.invalid.join(', ')}` },
          { status: 400 },
        );
      }
      data.events = subscription.events;
    }

    if ('description' in body) {
      data.description = typeof body.description === 'string' ? body.description.trim() || null : null;
    }

    if ('isActive' in body) {
      data.isActive = Boolean(body.isActive);
      // Re-enabling after an auto-disable starts the failure count over,
      // otherwise the next single failure would trip the limit again.
      if (data.isActive) {
        data.consecutiveFailures = 0;
        data.autoDisabledAt = null;
      }
    }

    // Rotating returns a fresh secret once, exactly like creation. The old
    // secret stops being valid the moment this returns.
    let rotated: string | null = null;
    if (body?.rotateSecret === true) {
      if (!process.env.ENCRYPTION_KEY) {
        return NextResponse.json(
          { error: 'Cannot rotate: ENCRYPTION_KEY is not configured on this deployment.' },
          { status: 503 },
        );
      }
      rotated = generateWebhookSecret();
      data.secret = encrypt(rotated);
    }

    const updated = await prisma.webhookEndpoint.update({
      where: { id: existing.id },
      data,
      select: PUBLIC_SELECT,
    });

    return NextResponse.json({ webhook: rotated ? { ...updated, secret: rotated } : updated });
  } catch (error) {
    console.error('Error updating webhook:', error);
    return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    const existing = await findScopedWebhook(id);
    if (!existing) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

    await prisma.webhookEndpoint.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
  }
}
