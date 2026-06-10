import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTenantId } from '@/lib/products/tenant';
import { getPublicArticleBySlug } from '@/lib/services/public-kb';
import Markdown from '@/components/Markdown';
import ArticleFeedback from '@/components/help/ArticleFeedback';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenantId = await getTenantId();
  const result = tenantId ? await getPublicArticleBySlug(tenantId, slug) : null;
  if (!result) return { title: 'Hjälpcenter' };
  return {
    title: `${result.article.title} – Hjälpcenter`,
    description: result.article.excerpt ?? undefined,
  };
}

export default async function HelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenantId = await getTenantId();
  if (!tenantId) notFound();

  const result = await getPublicArticleBySlug(tenantId, slug);
  if (!result) notFound();

  const { article, related } = result;

  return (
    <article className="space-y-6">
      <div>
        <Link href="/help" className="text-sm text-[#7C5CFF] hover:underline">
          ← Hjälpcenter
        </Link>
        {article.category && (
          <Link
            href={`/help/c/${article.category.slug}`}
            className="ml-2 text-sm text-slate-500 hover:underline"
          >
            {article.category.name}
          </Link>
        )}
        <h1 className="text-3xl font-bold mt-3">{article.title}</h1>
      </div>

      <Markdown>{article.content ?? ''}</Markdown>

      <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
        <ArticleFeedback slug={article.slug} />
      </div>

      {related.length > 0 && (
        <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
          <h2 className="text-lg font-semibold mb-3">Se även</h2>
          <ul className="space-y-2">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={`/help/${r.slug}`} className="text-[#7C5CFF] hover:underline">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
