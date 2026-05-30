// Seed the Tenant row for a product. One tenant per database (per deploy).
//
// By convention the tenant id == subdomain == the product key (matches the
// original "doldadress" row), so any id-based lookups keep working.
//
// Usage:
//   PRODUCT=serus node scripts/seed-tenant.js
//   node scripts/seed-tenant.js serus "Serus"
//
// Run against the product's own database, e.g.:
//   DATABASE_URL="postgres://…serus-db…" PRODUCT=serus node scripts/seed-tenant.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const key = (process.env.PRODUCT || process.argv[2] || '').trim().toLowerCase();
  if (!key) {
    console.error('Missing product key. Set PRODUCT=<key> or pass it as the first argument.');
    process.exit(1);
  }
  const name = process.argv[3] || key.charAt(0).toUpperCase() + key.slice(1);

  const tenant = await prisma.tenant.upsert({
    where: { subdomain: key },
    update: { name },
    create: { id: key, subdomain: key, name },
  });

  console.log(`Tenant ready: id=${tenant.id} subdomain=${tenant.subdomain} name="${tenant.name}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
