// Import knowledge-base articles for a product from a JSON file.
//
// Usage (run against the product's own database, after the tenant exists):
//   DATABASE_URL="<serus-db>" PRODUCT=serus node scripts/import-serus-knowledge.js
//   # optional custom file:
//   node scripts/import-serus-knowledge.js serus ./scripts/serus-knowledge.json
//
// Idempotent: matches existing articles by (tenantId, title) and updates them,
// otherwise creates a new active article. Safe to re-run after editing the JSON.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const key = (process.env.PRODUCT || process.argv[2] || 'serus').trim().toLowerCase();
  const file = process.argv[3] || path.join(__dirname, `${key}-knowledge.json`);

  if (!fs.existsSync(file)) {
    console.error(`Knowledge file not found: ${file}`);
    process.exit(1);
  }

  const articles = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(articles) || articles.length === 0) {
    console.error('Knowledge file must be a non-empty JSON array.');
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

  let created = 0;
  let updated = 0;
  for (const a of articles) {
    if (!a.title || !a.content) {
      console.warn('Skipping article without title/content:', a.title || '(no title)');
      continue;
    }
    const data = {
      title: a.title,
      content: a.content,
      category: a.category ?? null,
      tags: Array.isArray(a.tags) ? a.tags : [],
      isActive: a.isActive !== false,
    };

    const existing = await prisma.knowledgeBase.findFirst({
      where: { tenantId: tenant.id, title: a.title },
      select: { id: true },
    });

    if (existing) {
      await prisma.knowledgeBase.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.knowledgeBase.create({ data: { ...data, tenantId: tenant.id } });
      created += 1;
    }
  }

  console.log(`Knowledge import for '${key}': ${created} created, ${updated} updated (${articles.length} total).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
