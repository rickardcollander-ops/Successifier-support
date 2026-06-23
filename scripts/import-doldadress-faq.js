// Import (and PUBLISH) the public FAQ from doldadress.se/vanliga-fragor into the
// knowledge base / public help center.
//
// The data file `scripts/doldadress-faq.json` mirrors every question & answer
// from https://www.doldadress.se/vanliga-fragor (18 categories, 92 articles).
// Running this script makes the whole FAQ live in the public help center:
//
//   * each category becomes a browsable KnowledgeCategory (isPublic = true),
//   * each Q&A becomes a KnowledgeBase article that is BOTH usable by the AI
//     (isActive = true) AND visible in the help center
//     (isPublic = true, status = 'published'),
//   * articles get a stable slug, excerpt and ordering so they render and rank.
//
// Usage (run against the product's own database, after the tenant exists):
//   DATABASE_URL="<doldadress-db>" node scripts/import-doldadress-faq.js
//   # optional explicit tenant key / data file:
//   DATABASE_URL="..." node scripts/import-doldadress-faq.js doldadress ./scripts/doldadress-faq.json
//
// Idempotent: articles are matched by (tenantId, slug) and categories by
// (tenantId, slug), so it is safe to re-run after editing the JSON.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const key = (process.env.PRODUCT || process.argv[2] || 'doldadress').trim().toLowerCase();
  const file = process.argv[3] || path.join(__dirname, 'doldadress-faq.json');

  if (!fs.existsSync(file)) {
    console.error(`FAQ data file not found: ${file}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const articles = Array.isArray(data.articles) ? data.articles : [];
  if (articles.length === 0) {
    console.error('FAQ data file must contain a non-empty "articles" array.');
    process.exit(1);
  }

  // Tenant id == subdomain == product key by convention (see seed-tenant.js).
  const tenant = await prisma.tenant.findFirst({
    where: { OR: [{ id: key }, { subdomain: key }] },
    select: { id: true },
  });
  if (!tenant) {
    console.error(`Tenant '${key}' not found. Run scripts/seed-tenant.js first.`);
    process.exit(1);
  }
  const tenantId = tenant.id;

  // 1) Public, browsable categories. Matched by (tenantId, slug).
  const categoryIdBySlug = new Map();
  let catCreated = 0;
  let catUpdated = 0;
  for (const c of categories) {
    if (!c.name || !c.slug) continue;
    const existing = await prisma.knowledgeCategory.findFirst({
      where: { tenantId, slug: c.slug },
      select: { id: true },
    });
    const payload = {
      name: c.name,
      sortOrder: typeof c.sortOrder === 'number' ? c.sortOrder : 0,
      isPublic: true,
    };
    if (existing) {
      const row = await prisma.knowledgeCategory.update({
        where: { id: existing.id },
        data: payload,
        select: { id: true },
      });
      categoryIdBySlug.set(c.slug, row.id);
      catUpdated += 1;
    } else {
      const row = await prisma.knowledgeCategory.create({
        data: { ...payload, slug: c.slug, tenantId },
        select: { id: true },
      });
      categoryIdBySlug.set(c.slug, row.id);
      catCreated += 1;
    }
  }

  // 2) Articles — published & public. Matched by (tenantId, slug).
  let created = 0;
  let updated = 0;
  for (const a of articles) {
    if (!a.title || !a.content || !a.slug) {
      console.warn('Skipping article without title/content/slug:', a.title || a.slug || '(unknown)');
      continue;
    }
    const data = {
      title: a.title,
      content: a.content,
      excerpt: a.excerpt ?? null,
      // Free-text category is kept for the AI keyword rerank; categoryId powers
      // the browsable help center.
      category: a.category ?? null,
      categoryId: a.categorySlug ? categoryIdBySlug.get(a.categorySlug) ?? null : null,
      tags: Array.isArray(a.tags) ? a.tags : [],
      sortOrder: typeof a.sortOrder === 'number' ? a.sortOrder : 0,
      isActive: true,
      isPublic: true,
      status: 'published',
    };

    const existing = await prisma.knowledgeBase.findFirst({
      where: { tenantId, slug: a.slug },
      select: { id: true },
    });

    if (existing) {
      await prisma.knowledgeBase.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.knowledgeBase.create({ data: { ...data, slug: a.slug, tenantId } });
      created += 1;
    }
  }

  console.log(
    `FAQ import for '${key}': ` +
      `categories ${catCreated} created / ${catUpdated} updated; ` +
      `articles ${created} created / ${updated} updated (${articles.length} total, all published & public).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
