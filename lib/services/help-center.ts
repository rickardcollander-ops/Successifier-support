import { prisma } from '@/lib/db/client';

// Resolved appearance + chatbot settings for the public help center. Always
// fully populated: callers never deal with nulls for the structural fields.
export interface HelpCenterTheme {
  accentColor: string;
  theme: 'light' | 'dark' | 'auto';
  logoUrl: string | null;
  headline: string;
  intro: string | null;
  layout: 'grid' | 'list';
  showSearch: boolean;
  footerText: string | null;
  supportUrl: string | null;
  supportLabel: string | null;
  // Chatbot
  chatEnabled: boolean;
  chatTitle: string;
  chatWelcome: string;
  chatPlaceholder: string;
  chatInstructions: string | null;
  chatFallback: string | null;
  chatSuggestions: string[];
}

export const DEFAULT_HELP_CENTER: HelpCenterTheme = {
  accentColor: '#7C5CFF',
  theme: 'light',
  logoUrl: null,
  headline: 'Hur kan vi hjälpa dig?',
  intro: null,
  layout: 'grid',
  showSearch: true,
  footerText: null,
  supportUrl: null,
  supportLabel: null,
  chatEnabled: true,
  chatTitle: 'Fråga hjälpcentret',
  chatWelcome: 'Hej! Ställ en fråga så söker jag svar i vårt hjälpcenter.',
  chatPlaceholder: 'Skriv din fråga…',
  chatInstructions: null,
  chatFallback: null,
  chatSuggestions: [],
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
    footerText: row.footerText || null,
    supportUrl: row.supportUrl || null,
    supportLabel: row.supportLabel || null,
    chatEnabled: row.chatEnabled,
    chatTitle: row.chatTitle || DEFAULT_HELP_CENTER.chatTitle,
    chatWelcome: row.chatWelcome || DEFAULT_HELP_CENTER.chatWelcome,
    chatPlaceholder: row.chatPlaceholder || DEFAULT_HELP_CENTER.chatPlaceholder,
    chatInstructions: row.chatInstructions || null,
    chatFallback: row.chatFallback || null,
    chatSuggestions: Array.isArray(row.chatSuggestions) ? row.chatSuggestions : [],
  };
}

// The subset of help-center config that is SAFE to expose publicly (to the
// embeddable widget and any client). Deliberately excludes chatInstructions —
// that's the operator's private prompt steering and must stay server-side.
export interface PublicHelpConfig {
  accentColor: string;
  theme: HelpCenterTheme['theme'];
  logoUrl: string | null;
  headline: string;
  intro: string | null;
  layout: HelpCenterTheme['layout'];
  showSearch: boolean;
  footerText: string | null;
  supportUrl: string | null;
  supportLabel: string | null;
  chat: {
    enabled: boolean;
    title: string;
    welcome: string;
    placeholder: string;
    suggestions: string[];
  };
}

export function toPublicHelpConfig(c: HelpCenterTheme): PublicHelpConfig {
  return {
    accentColor: c.accentColor,
    theme: c.theme,
    logoUrl: c.logoUrl,
    headline: c.headline,
    intro: c.intro,
    layout: c.layout,
    showSearch: c.showSearch,
    footerText: c.footerText,
    supportUrl: c.supportUrl,
    supportLabel: c.supportLabel,
    chat: {
      enabled: c.chatEnabled,
      title: c.chatTitle,
      welcome: c.chatWelcome,
      placeholder: c.chatPlaceholder,
      suggestions: c.chatSuggestions,
    },
  };
}
