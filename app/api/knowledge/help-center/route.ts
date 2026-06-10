import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenantId } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';
import { getHelpCenterConfig, DEFAULT_HELP_CENTER } from '@/lib/services/help-center';

async function resolveTenantId(): Promise<string> {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error('Tenant not found');
  return tenantId;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Read the current help-center appearance (resolved with defaults).
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await resolveTenantId();
    return NextResponse.json({ config: await getHelpCenterConfig(tenantId) });
  } catch (error) {
    console.error('Error fetching help center config:', error);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
}

// Save the help-center appearance.
export async function PUT(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await resolveTenantId();
    const body = await request.json();

    const accentColor = typeof body.accentColor === 'string' && HEX.test(body.accentColor)
      ? body.accentColor
      : DEFAULT_HELP_CENTER.accentColor;
    const theme = ['light', 'dark', 'auto'].includes(body.theme) ? body.theme : 'light';
    const layout = body.layout === 'list' ? 'list' : 'grid';
    const showSearch = body.showSearch !== false;
    const logoUrl = typeof body.logoUrl === 'string' && body.logoUrl.trim() ? body.logoUrl.trim() : null;
    const headline = typeof body.headline === 'string' && body.headline.trim() ? body.headline.trim().slice(0, 120) : null;
    const intro = typeof body.intro === 'string' && body.intro.trim() ? body.intro.trim().slice(0, 400) : null;

    const data = { accentColor, theme, layout, showSearch, logoUrl, headline, intro };

    const config = await prisma.helpCenterConfig.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });

    return NextResponse.json({ config });
  } catch (error) {
    console.error('Error saving help center config:', error);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
