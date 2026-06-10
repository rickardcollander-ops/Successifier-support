const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const MARKER = '[Zendesk Import Source:';

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'doldadress' } });
  if (!tenant) {
    console.log(JSON.stringify({ error: 'NO_TENANT' }));
    return;
  }

  const visibleTickets = await prisma.ticket.findMany({
    where: {
      tenantId: tenant.id,
      NOT: { originalMessage: { contains: MARKER } },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      customerEmail: true,
      customerName: true,
      subject: true,
      status: true,
      createdAt: true,
    },
  });

  const emails = [...new Set(visibleTickets.map((t) => t.customerEmail))];

  console.log(
    JSON.stringify(
      {
        visibleCount: visibleTickets.length,
        emails,
        tickets: visibleTickets,
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
