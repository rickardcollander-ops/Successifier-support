import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTenantId } from '@/lib/products/tenant';
import { getPublicCategories, getPublicArticles } from '@/lib/services/public-kb';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const tenantId = await getTenantId();
  const cat = tenantId ? (await getPublicCategories(tenantId)).find((c) => c.slug === category) : null;
  return { title: cat ? `${cat.name} – Hjälpcenter` : 'Hjälpcenter' };
}

export default async function HelpCategory({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const tenantId = await getTenantId();
  if (!tenantId) notFound();

  const categories = await getPublicCategories(tenantId);
  const cat = categories.find((c) => c.slug === category);
  if (!cat) notFound();

  const { articles } = await getPublicArticles(tenantId, { categorySlug: category, pageSize: 100 });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/help" className="text-sm hover:underline" style={{ color: 'var(--kb-accent)' }}>
          ← Tillbaka
        </Link>
        <h1 className="text-2xl font-bold mt-2">{cat.name}</h1>
        {cat.description && <p className="text-[color:var(--kb-muted)] mt-1">{cat.description}</p>}
      </div>

      {articles.length === 0 ? (
        <p className="text-[color:var(--kb-muted)]">Inga artiklar i den här kategorin ännu.</p>
      ) : (
        <ul className="divide-y divide-[color:var(--kb-border)] rounded-xl border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] overflow-hidden">
          {articles.map((a) => (
            <li key={a.slug}>
              <Link href={`/help/${a.slug}`} className="block p-4 hover:bg-[color:var(--kb-hover)]">
                <div className="font-medium">{a.title}</div>
                {a.excerpt && <div className="text-sm text-[color:var(--kb-muted)] mt-0.5">{a.excerpt}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
