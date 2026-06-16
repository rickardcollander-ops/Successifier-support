import { NextRequest, NextResponse } from 'next/server';
import { translateToProductLanguage } from '@/lib/services/ai-generator';
import { requireApiAuth } from '@/lib/api-auth';
import { findScopedTicket } from '@/lib/db/scoped';
import { rateLimit, clientIp } from '@/lib/rate-limit';

// Translate a piece of a ticket's customer conversation into the product's
// own language, on demand from the ticket view. Scoped to a ticket so the
// caller must be authorized for that tenant's data.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  // Each call costs LLM tokens — cap bursts per client.
  const limit = rateLimit(`translate:${clientIp(request.headers)}`, { limit: 30, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const { id } = await params;

    const ticket = await findScopedTicket(id);
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const body = await request.json();
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }
    // Guard against pathological payloads — a single mail bubble is small.
    if (text.length > 20000) {
      return NextResponse.json({ error: 'Text too long to translate' }, { status: 413 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'Translation is not configured' }, { status: 500 });
    }

    const translated = await translateToProductLanguage(text);
    return NextResponse.json({ translated });
  } catch (error) {
    console.error('Error translating message:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to translate message', details: message },
      { status: 500 }
    );
  }
}
