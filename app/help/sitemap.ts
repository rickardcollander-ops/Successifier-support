import type { MetadataRoute } from 'next';
import { product } from '@/lib/products';
import { getTenantId } from '@/lib/products/tenant';
import { getPublicArticles, getPublicCategories } from '@/lib/services/public-kb';

// Served at /help/sitemap.xml. Lists the public help center URLs so the
// articles can be indexed when linked from the marketing site.
export const dynamic = 'force-dynamic';

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || `https://${product.apiBaseDomain}`).replace(/\/$/, '');
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = baseUrl();
  const entries: MetadataRoute.Sitemap = [{ url: `${base}/help`, changeFrequency: 'weekly', priority: 0.8 }];

  const tenantId = await getTenantId();
  if (!tenantId) return entries;

  const [categories, { articles }] = await Promise.all([
    getPublicCategories(tenantId),
    getPublicArticles(tenantId, { pageSize: 1000 }),
  ]);

  for (const c of categories) {
    entries.push({ url: `${base}/help/c/${c.slug}`, changeFrequency: 'weekly', priority: 0.6 });
  }
  for (const a of articles) {
    entries.push({
      url: `${base}/help/${a.slug}`,
      lastModified: a.updatedAt,
      changeFrequency: 'monthly',
      priority: 0.5,
    });
  }

  return entries;
}
