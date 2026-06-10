const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'doldadress' } });
  if (!tenant) throw new Error('tenant not found');

  const integration = await prisma.integration.findFirst({
    where: { tenantId: tenant.id, type: 'billecta' },
    select: { credentials: true, isActive: true },
  });

  if (!integration) {
    console.log('NO_BILLECTA_INTEGRATION');
    return;
  }

  const key = integration.credentials.apiKey;
  let decoded = null;

  try {
    decoded = Buffer.from(String(key), 'base64').toString('utf8');
  } catch {
    decoded = null;
  }

  console.log(
    JSON.stringify(
      {
        isActive: integration.isActive,
        keyLength: String(key || '').length,
        looksBase64: /^[A-Za-z0-9+/=]+$/.test(String(key || '')),
        decodedPreview: decoded ? decoded.slice(0, 30) : null,
        decodedLength: decoded ? decoded.length : 0,
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
