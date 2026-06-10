import Link from 'next/link';
import { getTenantId } from '@/lib/products/tenant';
import { getPublicCategories, getPublicArticles } from '@/lib/services/public-kb';
import { getHelpCenterConfig, DEFAULT_HELP_CENTER } from '@/lib/services/help-center';
import HelpSearch from '@/components/help/HelpSearch';

export const dynamic = 'force-dynamic';

export default async function HelpHome() {
  const tenantId = await getTenantId();
  const [config, categories, popular] = tenantId
    ? await Promise.all([
        getHelpCenterConfig(tenantId),
        getPublicCategories(tenantId),
        getPublicArticles(tenantId, { pageSize: 6 }),
      ])
    : [DEFAULT_HELP_CENTER, [], { articles: [], total: 0 }];

  const categoryGridClass =
    config.layout === 'list' ? 'space-y-3' : 'grid gap-4 sm:grid-cols-2';

  return (
    <div className="space-y-10">
      <section className="text-center space-y-4">
        <h1 className="text-3xl font-bold">{config.headline}</h1>
        {config.intro && <p className="text-[color:var(--kb-muted)] max-w-xl mx-auto">{config.intro}</p>}
        {config.showSearch && (
          <div className="max-w-xl mx-auto text-left">
            <HelpSearch />
          </div>
        )}
      </section>

      {categories.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">Kategorier</h2>
          <div className={categoryGridClass}>
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/help/c/${c.slug}`}
                className="block p-5 rounded-xl border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] hover:border-[color:var(--kb-accent)] transition-colors"
              >
                <div className="font-medium">{c.name}</div>
                {c.description && (
                  <p className="text-sm text-[color:var(--kb-muted)] mt-1">{c.description}</p>
                )}
                <p className="text-xs text-[color:var(--kb-muted)] mt-2">{c.articleCount} artiklar</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {popular.articles.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">Populära artiklar</h2>
          <ul className="space-y-2">
            {popular.articles.map((a) => (
              <li key={a.slug}>
                <Link href={`/help/${a.slug}`} className="hover:underline" style={{ color: 'var(--kb-accent)' }}>
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {categories.length === 0 && popular.articles.length === 0 && (
        <p className="text-center text-[color:var(--kb-muted)]">Inga publicerade artiklar ännu.</p>
      )}
    </div>
  );
}
