import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';
import { computeReportData } from '@/lib/reports/compute';

// Thin wrapper: auth → params → tenant → computeReportData. The whole report
// computation lives in lib/reports/compute.ts so scheduled digests and the
// previous-period comparison run exactly the same math as this route.

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const searchParams = request.nextUrl.searchParams;

    const tenant = await getTenant();
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const data = await computeReportData(tenant.id, {
      range: searchParams.get('range') || '30d',
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      agent: searchParams.get('agent'),
      status: searchParams.get('status'),
      priority: searchParams.get('priority'),
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching report data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch report data' },
      { status: 500 }
    );
  }
}
