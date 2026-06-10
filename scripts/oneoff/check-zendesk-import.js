const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'doldadress' } });
  if (!tenant) {
    console.log(JSON.stringify({ error: 'NO_TENANT' }));
    return;
  }

  const total = await prisma.ticket.count({ where: { tenantId: tenant.id } });
  const imported = await prisma.ticket.count({
    where: {
      tenantId: tenant.id,
      originalMessage: { contains: '[Zendesk Import Source:' },
    },
  });

  const recentImported = await prisma.ticket.findMany({
    where: {
      tenantId: tenant.id,
      originalMessage: { contains: '[Zendesk Import Source:' },
    },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: {
      id: true,
      subject: true,
      customerEmail: true,
      status: true,
      priority: true,
      createdAt: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        tenantId: tenant.id,
        total,
        imported,
        recentImported,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
