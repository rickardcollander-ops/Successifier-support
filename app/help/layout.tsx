import type { Metadata } from 'next';
import Link from 'next/link';
import { product } from '@/lib/products';
import { resolveTenantFromHeaders } from '@/lib/products/tenant';
import { getHelpCenterConfig, DEFAULT_HELP_CENTER } from '@/lib/services/help-center';
import HelpChat from '@/components/help/HelpChat';

export async function generateMetadata(): Promise<Metadata> {
  await resolveTenantFromHeaders();
  return {
    title: `Hjälpcenter – ${product.displayName}`,
    description: `Vanliga frågor, guider och svar för ${product.brandName}.`,
  };
}

export default async function HelpLayout({ children }: { children: React.ReactNode }) {
  const ctx = await resolveTenantFromHeaders();
  const tenantId = ctx?.tenant.id ?? null;
  const config = tenantId ? await getHelpCenterConfig(tenantId) : DEFAULT_HELP_CENTER;

  return (
    <div
      className="kb-root min-h-screen"
      data-theme={config.theme}
      style={{ ['--kb-accent' as string]: config.accentColor } as React.CSSProperties}
    >
      <header className="border-b border-[color:var(--kb-border)] bg-[color:var(--kb-surface)]/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between">
          <Link href="/help" className="flex items-center gap-3 font-semibold text-lg">
            {config.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={config.logoUrl} alt={product.brandName} className="h-8 w-auto" />
            ) : (
              <>
                {product.brandName}{' '}
                <span style={{ color: 'var(--kb-accent)' }}>Hjälpcenter</span>
              </>
            )}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-4xl px-4 py-8 text-sm text-[color:var(--kb-muted)] flex flex-wrap items-center justify-between gap-3">
        <span>{config.footerText || `© ${new Date().getFullYear()} ${product.brandName}`}</span>
        {config.supportUrl && (
          <a
            href={config.supportUrl}
            className="hover:underline"
            style={{ color: 'var(--kb-accent)' }}
          >
            {config.supportLabel || 'Kontakta supporten'}
          </a>
        )}
      </footer>
      {config.chatEnabled && (
        <HelpChat
          title={config.chatTitle}
          welcome={config.chatWelcome}
          placeholder={config.chatPlaceholder}
          suggestions={config.chatSuggestions}
        />
      )}
    </div>
  );
}
