import { NextRequest, NextResponse } from 'next/server';
import { getTenantId } from '@/lib/products/tenant';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { corsHeaders, logKbEvent } from '@/lib/services/public-kb';
import { answerFromPublicKb, type ChatTurn } from '@/lib/services/public-kb-chat';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

// Coerce arbitrary JSON into a clean, bounded history array. Anything that
// isn't a well-formed {role, content} turn is dropped.
function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is { role: string; content: string } =>
        !!t &&
        typeof t === 'object' &&
        (t as { role?: unknown }).role !== undefined &&
        typeof (t as { content?: unknown }).content === 'string'
    )
    .map<ChatTurn>((t) => ({
      role: t.role === 'assistant' ? 'assistant' : 'user',
      content: t.content,
    }))
    .slice(-6);
}

export async function POST(request: NextRequest) {
  const cors = corsHeaders(request.headers.get('origin'));

  // Stricter than search (60/min): each call is an LLM request, so cap harder.
  const { allowed, retryAfterSeconds } = rateLimit(`pkb:chat:${clientIp(request.headers)}`, {
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

    const body = await request.json().catch(() => ({}));
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (question.length < 2 || question.length > 1000) {
      return NextResponse.json(
        { error: 'Invalid question' },
        { status: 400, headers: cors }
      );
    }

    const history = parseHistory(body?.history);
    const result = await answerFromPublicKb(tenantId, question, history);

    // Reuse the KB analytics stream: log the question as a search so that
    // unanswered questions (resultsCount = 0) surface content gaps alongside
    // the existing "searches with no result" report.
    void logKbEvent(tenantId, {
      type: 'search',
      query: question,
      resultsCount: result.sources.length,
    });

    return NextResponse.json(result, { headers: cors });
  } catch (error) {
    console.error('[public-kb] chat error:', error);
    return NextResponse.json({ error: 'Chat failed' }, { status: 500, headers: cors });
  }
}
