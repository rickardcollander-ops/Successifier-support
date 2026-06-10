const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const TICKETS = [
  {
    customerName: "Stella Klara Lindgren",
    customerEmail: "Stella.lindgrenn@gmail.com",
    subject: "Faktura förnyades trots att jag trodde tjänsten var pausad",
    originalMessage:
      "Hej! Jag såg en ny faktura från er i Billecta i morse men jag trodde att mitt abonnemang var pausat. Kan ni förklara varför fakturan skapades och om ni kan justera den?",
  },
  {
    customerName: "Ida Rosell",
    customerEmail: "idarosell13@gmail.com",
    subject: "Påminnelseavgift på fakturan - behöver hjälp",
    originalMessage:
      "Hej support, jag fick en påminnelseavgift i Billecta men jag hann inte se första utskicket. Finns det möjlighet att ta bort avgiften denna gång och skicka om betalningslänken?",
  },
  {
    customerName: "Karl Emil Rasmus Olsson",
    customerEmail: "radde_3@hotmail.com",
    subject: "Dubbeldebiterad enligt Billecta",
    originalMessage:
      "Hej! Det verkar som att två dragningar har registrerats i Billecta för samma period. Kan ni kontrollera om jag blivit dubbeldebiterad och återbetala den ena om det stämmer?",
  },
  {
    customerName: "Johanna Rebecka Mets",
    customerEmail: "Johannamets93@hotmail.com",
    subject: "Vill säga upp men har öppen faktura",
    originalMessage:
      "Hej, jag vill avsluta tjänsten men ser att det finns en öppen faktura i Billecta. Jag vill gärna få bekräftat vad som gäller för uppsägning och om ni kan skicka tydliga nästa steg.",
  },
];

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [{ subdomain: "doldadress" }, { id: "doldadress" }],
    },
    select: { id: true },
  });

  if (!tenant) {
    throw new Error("Tenant 'doldadress' not found");
  }

  const tenantId = tenant.id;

  const deleted = await prisma.ticket.deleteMany({
    where: { tenantId },
  });

  await prisma.integration.updateMany({
    where: {
      tenantId,
      type: { not: "billecta" },
    },
    data: { isActive: false },
  });

  const created = [];
  for (const ticket of TICKETS) {
    const row = await prisma.ticket.create({
      data: {
        tenantId,
        customerName: ticket.customerName,
        customerEmail: ticket.customerEmail,
        subject: ticket.subject,
        originalMessage: ticket.originalMessage,
        status: "new",
        priority: "normal",
      },
      select: {
        id: true,
        customerName: true,
        customerEmail: true,
        subject: true,
        status: true,
      },
    });
    created.push(row);
  }

  console.log(
    JSON.stringify(
      {
        tenantId,
        deletedTickets: deleted.count,
        createdCount: created.length,
        created,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
