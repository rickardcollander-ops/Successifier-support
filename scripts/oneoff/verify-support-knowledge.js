const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [{ id: 'doldadress' }, { subdomain: 'doldadress' }],
    },
    select: { id: true },
  });

  if (!tenant) throw new Error('Tenant doldadress hittades inte.');

  const rows = await prisma.knowledgeBase.findMany({
    where: {
      tenantId: tenant.id,
      title: { startsWith: 'Supportmall:' },
    },
    select: {
      title: true,
      category: true,
      isActive: true,
      updatedAt: true,
      content: true,
    },
    orderBy: { title: 'asc' },
  });

  const preview = rows.map((r) => ({
    title: r.title,
    category: r.category,
    isActive: r.isActive,
    updatedAt: r.updatedAt,
    contentPreview: r.content.slice(0, 120),
  }));

  console.log(JSON.stringify({ count: rows.length, preview }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
