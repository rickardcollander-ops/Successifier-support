import { NextRequest, NextResponse } from 'next/server';
import { getTenantId } from '@/lib/products/tenant';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { getPublicCategories, corsHeaders } from '@/lib/services/public-kb';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function GET(request: NextRequest) {
  const cors = corsHeaders(request.headers.get('origin'));

  const { allowed, retryAfterSeconds } = rateLimit(`pkb:cat:${clientIp(request.headers)}`, {
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
    if (!tenantId) return NextResponse.json({ categories: [] }, { headers: cors });

    const categories = await getPublicCategories(tenantId);
    return NextResponse.json({ categories }, { headers: cors });
  } catch (error) {
    console.error('[public-kb] categories error:', error);
    return NextResponse.json({ error: 'Failed to load categories' }, { status: 500, headers: cors });
  }
}
