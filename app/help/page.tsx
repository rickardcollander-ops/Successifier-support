import Link from 'next/link';
import { getTenantId } from '@/lib/products/tenant';
import { getPublicCategories, getPublicArticles } from '@/lib/services/public-kb';
import HelpSearch from '@/components/help/HelpSearch';

export const dynamic = 'force-dynamic';

export default async function HelpHome() {
  const tenantId = await getTenantId();
  const [categories, popular] = tenantId
    ? await Promise.all([getPublicCategories(tenantId), getPublicArticles(tenantId, { pageSize: 6 })])
    : [[], { articles: [], total: 0 }];

  return (
    <div className="space-y-10">
      <section className="text-center space-y-4">
        <h1 className="text-3xl font-bold">Hur kan vi hjälpa dig?</h1>
        <div className="max-w-xl mx-auto text-left">
          <HelpSearch />
        </div>
      </section>

      {categories.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">Kategorier</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/help/c/${c.slug}`}
                className="block p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#7C5CFF] transition-colors"
              >
                <div className="font-medium">{c.name}</div>
                {c.description && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{c.description}</p>
                )}
                <p className="text-xs text-slate-400 mt-2">{c.articleCount} artiklar</p>
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
                <Link href={`/help/${a.slug}`} className="text-[#7C5CFF] hover:underline">
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {categories.length === 0 && popular.articles.length === 0 && (
        <p className="text-center text-slate-500 dark:text-slate-400">
          Inga publicerade artiklar ännu.
        </p>
      )}
    </div>
  );
}
