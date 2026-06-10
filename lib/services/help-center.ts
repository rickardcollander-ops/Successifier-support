import { prisma } from '@/lib/db/client';

// Resolved appearance for the public help center. Always fully populated:
// callers never deal with nulls for the structural fields.
export interface HelpCenterTheme {
  accentColor: string;
  theme: 'light' | 'dark' | 'auto';
  logoUrl: string | null;
  headline: string;
  intro: string | null;
  layout: 'grid' | 'list';
  showSearch: boolean;
}

export const DEFAULT_HELP_CENTER: HelpCenterTheme = {
  accentColor: '#7C5CFF',
  theme: 'light',
  logoUrl: null,
  headline: 'Hur kan vi hjälpa dig?',
  intro: null,
  layout: 'grid',
  showSearch: true,
};

function normalizeTheme(v: string | null | undefined): HelpCenterTheme['theme'] {
  return v === 'dark' || v === 'auto' ? v : 'light';
}

function normalizeLayout(v: string | null | undefined): HelpCenterTheme['layout'] {
  return v === 'list' ? 'list' : 'grid';
}

/** Read the stored help-center config, merged onto sensible defaults. */
export async function getHelpCenterConfig(tenantId: string): Promise<HelpCenterTheme> {
  const row = await prisma.helpCenterConfig.findUnique({ where: { tenantId } });
  if (!row) return DEFAULT_HELP_CENTER;
  return {
    accentColor: row.accentColor || DEFAULT_HELP_CENTER.accentColor,
    theme: normalizeTheme(row.theme),
    logoUrl: row.logoUrl || null,
    headline: row.headline || DEFAULT_HELP_CENTER.headline,
    intro: row.intro || null,
    layout: normalizeLayout(row.layout),
    showSearch: row.showSearch,
  };
}
