const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'doldadress' } });
  if (!tenant) throw new Error('Tenant not found');

  const draft = await prisma.knowledgeBase.findFirst({
    where: {
      tenantId: tenant.id,
      title: { startsWith: 'AI Draft:' },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, isActive: true },
  });

  if (!draft) {
    console.log('NO_DRAFT_FOUND');
    return;
  }

  const renamed = draft.title.replace(/^\s*AI\s*Draft:\s*/i, '').trim();

  await prisma.knowledgeBase.update({
    where: { id: draft.id },
    data: { isActive: true, title: renamed },
  });

  const updated = await prisma.knowledgeBase.findUnique({
    where: { id: draft.id },
    select: { id: true, title: true, isActive: true },
  });

  console.log(JSON.stringify({ before: draft, after: updated }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
