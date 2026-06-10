import { NextRequest, NextResponse } from 'next/server';
import { getTenantId } from '@/lib/products/tenant';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { searchPublicArticles, logKbEvent, corsHeaders } from '@/lib/services/public-kb';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function GET(request: NextRequest) {
  const cors = corsHeaders(request.headers.get('origin'));

  const { allowed, retryAfterSeconds } = rateLimit(`pkb:search:${clientIp(request.headers)}`, {
    limit: 60,
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
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();

    if (!tenantId || q.length < 2) {
      return NextResponse.json({ query: q, results: [] }, { headers: cors });
    }

    const results = await searchPublicArticles(tenantId, q);
    // Log search + result count so "no result" queries surface content gaps.
    void logKbEvent(tenantId, { type: 'search', query: q, resultsCount: results.length });

    return NextResponse.json({ query: q, results }, { headers: cors });
  } catch (error) {
    console.error('[public-kb] search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500, headers: cors });
  }
}
