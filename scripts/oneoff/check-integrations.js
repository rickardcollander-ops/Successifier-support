const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'doldadress' } });
  if (!tenant) {
    console.log(JSON.stringify({ error: 'NO_TENANT' }));
    return;
  }

  const integrations = await prisma.integration.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, type: true, isActive: true, credentials: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });

  console.log(JSON.stringify({ tenantId: tenant.id, integrations }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
