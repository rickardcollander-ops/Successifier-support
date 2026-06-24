import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenantId } from '@/lib/products/tenant';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { corsHeaders } from '@/lib/services/public-kb';
import { getHelpCenterConfig } from '@/lib/services/help-center';
import { streamAuthedChatResponse, type ChatTurn } from '@/lib/services/public-kb-chat';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { verifyIdentityToken } from '@/lib/identity-token';

export const dynamic = 'force-dynamic';

// Chatbot for a LOGGED-IN customer. Same streaming contract as the public
// /api/public/kb/chat, but it also answers questions about the customer's own
// account by pulling live data from the tenant's connected systems (Stripe,
// Billecta, Retool, Resend, …).
//
// IDENTITY: the customer's email is read ONLY from a signed identity token
// (X-Identity-Token), minted by the customer's own backend after login. We
// never trust an email from the request body — that would let anyone request
// someone else's data.

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

// Reuse the public chat's history coercion: bounded, well-formed turns only.
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

  // Verify identity FIRST so unauthenticated/forged requests never reach the
  // (expensive) data-gathering or LLM path.
  const token = request.headers.get('x-identity-token');
  const verified = verifyIdentityToken(token);
  if (!verified.ok) {
    return NextResponse.json({ error: 'Invalid or expired identity token' }, { status: 401, headers: cors });
  }
  const email = verified.claims.email;

  // Rate limit per verified identity (falling back to IP), since each call is
  // both an LLM request and a fan-out to external systems.
  const { allowed, retryAfterSeconds } = rateLimit(`me:chat:${email || clientIp(request.headers)}`, {
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
      return NextResponse.json({ error: 'Chat disabled' }, { status: 404, headers: cors });
    }

    const body = await request.json().catch(() => ({}));
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (question.length < 2 || question.length > 1000) {
      return NextResponse.json({ error: 'Invalid question' }, { status: 400, headers: cors });
    }

    const history = parseHistory(body?.history);

    // Gather the verified customer's context from the tenant's active
    // integrations — the SAME aggregator the ticket pipeline uses, looked up by
    // the trusted email from the token.
    const integrations = await prisma.integration.findMany({
      where: { tenantId, isActive: true },
    });
    const aggregator = new ContextAggregator();
    let customerContext = '';
    try {
      const context = await aggregator.gatherContext(email, integrations as any);
      // formatContextForAI always emits a header, so only use it when at least
      // one integration actually returned data — otherwise leave it empty so
      // the chat treats this as "no account data".
      if (Object.keys(context).length > 0) {
        customerContext = aggregator.formatContextForAI(context);
      }
    } catch (error) {
      // A failing integration must not take down the chat — answer from KB
      // (and whatever context we did get) instead.
      console.error('[me/chat] context gathering failed:', error);
    }

    const stream = await streamAuthedChatResponse(tenantId, question, customerContext, history);

    return new NextResponse(stream, {
      headers: {
        ...cors,
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[me/chat] error:', error);
    return NextResponse.json({ error: 'Chat failed' }, { status: 500, headers: cors });
  }
}
