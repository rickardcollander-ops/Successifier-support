import { NextRequest, NextResponse } from 'next/server';
import { getTenantId } from '@/lib/products/tenant';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { getPublicArticleId, logKbEvent, corsHeaders } from '@/lib/services/public-kb';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const cors = corsHeaders(request.headers.get('origin'));

  const { allowed, retryAfterSeconds } = rateLimit(`pkb:fb:${clientIp(request.headers)}`, {
    limit: 30,
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
    const body = await request.json().catch(() => ({}));
    const helpful = body?.helpful === true;

    const id = await getPublicArticleId(tenantId, slug);
    if (!id) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: cors });

    await logKbEvent(tenantId, { type: helpful ? 'helpful' : 'unhelpful', articleId: id });
    return NextResponse.json({ success: true }, { headers: cors });
  } catch (error) {
    console.error('[public-kb] feedback error:', error);
    return NextResponse.json({ error: 'Failed to record feedback' }, { status: 500, headers: cors });
  }
}
