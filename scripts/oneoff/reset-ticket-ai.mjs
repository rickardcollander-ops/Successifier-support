import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { subdomain: 'doldadress' },
    select: { id: true },
  });

  if (!tenant) {
    throw new Error("Tenant 'doldadress' not found");
  }

  const result = await prisma.ticket.updateMany({
    where: { tenantId: tenant.id },
    data: {
      aiResponse: null,
      aiConfidence: null,
      finalResponse: null,
      contextData: null,
      status: 'new',
    },
  });

  console.log(`Reset AI fields on ${result.count} tickets.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
