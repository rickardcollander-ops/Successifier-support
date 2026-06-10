import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { subdomain: 'doldadress' },
    select: { id: true },
  });

  if (!tenant) throw new Error("Tenant 'doldadress' not found");

  const rows = await prisma.ticket.findMany({
    where: { tenantId: tenant.id },
    select: {
      id: true,
      customerEmail: true,
      customerName: true,
      subject: true,
      contextData: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 120,
  });

  for (const r of rows) {
    console.log([
      r.id,
      r.customerEmail,
      r.subject,
      r.contextData ? 'HAS_CONTEXT' : 'NO_CONTEXT',
    ].join(' | '));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
