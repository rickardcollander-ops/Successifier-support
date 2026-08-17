import { NextRequest, NextResponse } from 'next/server';
import { getTenantId } from '@/lib/products/tenant';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { corsHeaders } from '@/lib/services/public-kb';
import { getHelpCenterConfig } from '@/lib/services/help-center';
import { streamChatResponse } from '@/lib/services/public-kb-chat';

// Step 1 of the AI contact form: the customer has typed their question and we
// try to answer it INSTANTLY from the public knowledge base, before any
// ticket exists. Same grounded streaming core as the help-center chat
// (streamChatResponse), same NDJSON protocol, same operator kill switch
// (chatEnabled) — the form degrades to a plain contact form when the
// operator has turned the AI off.

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function POST(request: NextRequest) {
  const cors = corsHeaders(request.headers.get('origin'));

  // Each call is an LLM request — cap like the chat widget.
  const { allowed, retryAfterSeconds } = rateLimit(`contact:answer:${clientIp(request.headers)}`, {
    limit: 12,
    windowMs: 60_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...cors, 'Retry-After': String(retryAfterSeconds) } }
    );
  }

  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: 'Not available' }, { status: 404, headers: cors });
    }

    const config = await getHelpCenterConfig(tenantId);
    if (!config.chatEnabled) {
      return NextResponse.json({ error: 'AI answers disabled' }, { status: 404, headers: cors });
    }

    const body = await request.json().catch(() => ({}));
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (question.length < 2 || question.length > 5000) {
      return NextResponse.json({ error: 'Invalid question' }, { status: 400, headers: cors });
    }

    const stream = await streamChatResponse(tenantId, question);

    return new NextResponse(stream, {
      headers: {
        ...cors,
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[contact-form] answer error:', error);
    return NextResponse.json({ error: 'Answer failed' }, { status: 500, headers: cors });
  }
}
