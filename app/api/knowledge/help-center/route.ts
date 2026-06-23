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

    // Trim + cap a free-text field, or null when empty.
    const str = (v: unknown, max: number): string | null =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

    const accentColor = typeof body.accentColor === 'string' && HEX.test(body.accentColor)
      ? body.accentColor
      : DEFAULT_HELP_CENTER.accentColor;
    const theme = ['light', 'dark', 'auto'].includes(body.theme) ? body.theme : 'light';
    const layout = body.layout === 'list' ? 'list' : 'grid';
    const showSearch = body.showSearch !== false;
    const logoUrl = str(body.logoUrl, 500);
    const headline = str(body.headline, 120);
    const intro = str(body.intro, 400);

    // Extra appearance
    const footerText = str(body.footerText, 300);
    const supportUrl = str(body.supportUrl, 500);
    const supportLabel = str(body.supportLabel, 80);

    // Chatbot
    const chatEnabled = body.chatEnabled !== false;
    const chatTitle = str(body.chatTitle, 80);
    const chatWelcome = str(body.chatWelcome, 500);
    const chatPlaceholder = str(body.chatPlaceholder, 120);
    const chatInstructions = str(body.chatInstructions, 4000);
    const chatFallback = str(body.chatFallback, 500);
    const chatSuggestions = Array.isArray(body.chatSuggestions)
      ? body.chatSuggestions
          .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
          .map((s: string) => s.trim().slice(0, 150))
          .slice(0, 6)
      : [];

    const data = {
      accentColor, theme, layout, showSearch, logoUrl, headline, intro,
      footerText, supportUrl, supportLabel,
      chatEnabled, chatTitle, chatWelcome, chatPlaceholder, chatInstructions, chatFallback, chatSuggestions,
    };

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
