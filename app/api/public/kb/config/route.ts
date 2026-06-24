import { NextRequest, NextResponse } from 'next/server';
import { getTenantId } from '@/lib/products/tenant';
import { corsHeaders } from '@/lib/services/public-kb';
import { getHelpCenterConfig, toPublicHelpConfig, DEFAULT_HELP_CENTER } from '@/lib/services/help-center';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

// Public help-center appearance + chatbot UI strings, used by the embeddable
// widget to match the configured design. Read-only and key-less. Returns only
// the safe subset (never chatInstructions — that's server-side prompt steering).
export async function GET(request: NextRequest) {
  const cors = corsHeaders(request.headers.get('origin'));
  try {
    const tenantId = await getTenantId();
    const config = tenantId ? await getHelpCenterConfig(tenantId) : DEFAULT_HELP_CENTER;
    return NextResponse.json(toPublicHelpConfig(config), { headers: cors });
  } catch (error) {
    console.error('[public-kb] config error:', error);
    return NextResponse.json(toPublicHelpConfig(DEFAULT_HELP_CENTER), { headers: cors });
  }
}
