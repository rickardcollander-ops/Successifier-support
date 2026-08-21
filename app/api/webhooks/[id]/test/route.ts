import { NextRequest, NextResponse } from 'next/server';
import { requireSettingsAdmin } from '@/lib/api-auth';
import { findScopedWebhook } from '@/lib/db/scoped';
import { sendTestDelivery } from '@/lib/webhooks/dispatch';
import { rateLimit, clientIp } from '@/lib/rate-limit';

// Sends a `ping` to one endpoint and waits for the result, so the customer
// gets a verdict in the portal instead of having to go read their own logs.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  const limit = rateLimit(`webhook-test:${clientIp(request.headers)}`, { limit: 10, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many test deliveries' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const { id } = await params;
    const endpoint = await findScopedWebhook(id);
    if (!endpoint) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

    const result = await sendTestDelivery(endpoint);
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Error sending test webhook:', error);
    return NextResponse.json({ error: 'Failed to send test delivery' }, { status: 500 });
  }
}
