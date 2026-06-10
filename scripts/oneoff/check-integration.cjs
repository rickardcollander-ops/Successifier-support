const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const integrations = await p.integration.findMany({
    where: { tenantId: 'doldadress-tenant' }
  });
  
  for (const i of integrations) {
    console.log(`Type: ${i.type}`);
    console.log(`Active: ${i.isActive}`);
    console.log(`Credentials keys: ${Object.keys(i.credentials)}`);
    console.log(`Has apiKey: ${!!i.credentials.apiKey}`);
    console.log(`Has creditorPublicId: ${!!i.credentials.creditorPublicId}`);
    console.log('---');
  }
  
  await p.$disconnect();
}

main();
