import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireSettingsAdmin } from '@/lib/api-auth';
import { getTenantId } from '@/lib/products/tenant';
import { encrypt } from '@/lib/crypto';
import { generateWebhookSecret } from '@/lib/webhooks/signature';
import { normalizeSubscription } from '@/lib/webhooks/events';
import { validateWebhookUrl } from '@/lib/webhooks/url';

// Endpoints a customer registers to receive ticket events. Operator-only,
// like API keys: an API key must not be able to mint a new destination for
// the tenant's ticket data.

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

/**
 * Endpoint secrets are stored encrypted, so a deployment without
 * ENCRYPTION_KEY cannot register one. Say so plainly instead of surfacing a
 * generic 500 that looks like a bug in the customer's request.
 */
function encryptionUnavailable(): NextResponse | null {
  if (process.env.ENCRYPTION_KEY) return null;
  return NextResponse.json(
    { error: 'Webhooks are unavailable on this deployment: ENCRYPTION_KEY is not configured.' },
    { status: 503 },
  );
}

export async function GET() {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await getTenantId();
    if (!tenantId) return NextResponse.json({ webhooks: [] });

    const webhooks = await prisma.webhookEndpoint.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_SELECT,
    });

    return NextResponse.json({ webhooks });
  } catch (error) {
    console.error('Error fetching webhooks:', error);
    return NextResponse.json({ error: 'Failed to fetch webhooks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  const unavailable = encryptionUnavailable();
  if (unavailable) return unavailable;

  try {
    const tenantId = await getTenantId();
    if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    const body = await request.json();

    const url = validateWebhookUrl(body?.url);
    if (!url.ok) return NextResponse.json({ error: url.error }, { status: 400 });

    const subscription = normalizeSubscription(body?.events);
    if (!subscription.ok) {
      return NextResponse.json(
        { error: `Unknown event type: ${subscription.invalid.join(', ')}` },
        { status: 400 },
      );
    }

    const secret = generateWebhookSecret();
    const created = await prisma.webhookEndpoint.create({
      data: {
        tenantId,
        url: url.url,
        description: typeof body?.description === 'string' ? body.description.trim() || null : null,
        secret: encrypt(secret),
        events: subscription.events,
      },
      select: PUBLIC_SELECT,
    });

    // The signing secret is returned exactly once — only the encrypted form
    // is stored, and no read endpoint ever returns it again.
    return NextResponse.json({ webhook: { ...created, secret } });
  } catch (error) {
    console.error('Error creating webhook:', error);
    return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
  }
}
