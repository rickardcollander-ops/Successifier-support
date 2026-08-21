import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireApiAuth } from '@/lib/api-auth';
import { product } from '@/lib/products';
import { buildOpenApiSpec } from '@/lib/openapi';

// Guarded by requireApiAuth, which accepts an API key — the same credential
// the integrator is about to use — so tooling can fetch the spec directly:
//
//   curl -H "X-API-Key: $KEY" https://<host>/api/openapi
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const h = await headers();
  const host = h.get('host') ?? `your-subdomain.${product.apiBaseDomain}`;
  const proto = h.get('x-forwarded-proto') ?? 'https';

  return NextResponse.json(buildOpenApiSpec(`${proto}://${host}`), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
