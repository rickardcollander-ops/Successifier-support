import { NextRequest, NextResponse } from 'next/server';
import { getTenantId } from '@/lib/products/tenant';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { corsHeaders, logKbEvent } from '@/lib/services/public-kb';

// The happy path of the AI contact form: the customer clicked "det löste min
// fråga" after reading the instant answer, so NO ticket is created. We log it
// as a form_resolved event — together with form_escalated this is the form's
// deflection rate. Fire-and-forget from the client; always best-effort.

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function POST(request: NextRequest) {
  const cors = corsHeaders(request.headers.get('origin'));

  const { allowed } = rateLimit(`contact:feedback:${clientIp(request.headers)}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: cors });
  }

  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: 'Not available' }, { status: 404, headers: cors });
    }

    const body = await request.json().catch(() => ({}));
    const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 200) : '';

    void logKbEvent(tenantId, { type: 'form_resolved', query: question || undefined });

    return NextResponse.json({ success: true }, { headers: cors });
  } catch (error) {
    console.error('[contact-form] feedback error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500, headers: cors });
  }
}
