import { NextRequest, NextResponse } from 'next/server';
import { getTenantId } from '@/lib/products/tenant';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { getPublicArticles, corsHeaders } from '@/lib/services/public-kb';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function GET(request: NextRequest) {
  const cors = corsHeaders(request.headers.get('origin'));

  const { allowed, retryAfterSeconds } = rateLimit(`pkb:list:${clientIp(request.headers)}`, {
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
    if (!tenantId) return NextResponse.json({ articles: [], total: 0 }, { headers: cors });

    const { searchParams } = new URL(request.url);
    const categorySlug = searchParams.get('category') || undefined;
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1);

    const result = await getPublicArticles(tenantId, { categorySlug, page });
    return NextResponse.json(result, { headers: cors });
  } catch (error) {
    console.error('[public-kb] articles error:', error);
    return NextResponse.json({ error: 'Failed to load articles' }, { status: 500, headers: cors });
  }
}
