import { NextRequest, NextResponse } from 'next/server';
import { getTenantId } from '@/lib/products/tenant';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import {
  getPublicArticleBySlug,
  getPublicArticleId,
  incrementViewCount,
  logKbEvent,
  corsHeaders,
} from '@/lib/services/public-kb';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const cors = corsHeaders(request.headers.get('origin'));

  const { allowed, retryAfterSeconds } = rateLimit(`pkb:article:${clientIp(request.headers)}`, {
    limit: 120,
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
    if (!tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: cors });

    const { slug } = await params;
    const result = await getPublicArticleBySlug(tenantId, slug);
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: cors });

    // Fire-and-forget analytics; never block the response on it.
    const id = await getPublicArticleId(tenantId, slug);
    if (id) {
      void incrementViewCount(id);
      void logKbEvent(tenantId, { type: 'view', articleId: id });
    }

    return NextResponse.json(result, { headers: cors });
  } catch (error) {
    console.error('[public-kb] article error:', error);
    return NextResponse.json({ error: 'Failed to load article' }, { status: 500, headers: cors });
  }
}
