const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function probe(url, headers) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      bodyPreview: text.slice(0, 180),
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'doldadress' } });
  if (!tenant) throw new Error('tenant not found');

  const integration = await prisma.integration.findFirst({
    where: { tenantId: tenant.id, type: 'billecta' },
    select: { credentials: true },
  });
  if (!integration) throw new Error('billecta integration not found');

  const rawKey = String(integration.credentials.apiKey || '').trim();
  const decodedKey = Buffer.from(rawKey, 'base64').toString('utf8').trim();
  const creditor = String(integration.credentials.creditorPublicId || '').trim();

  const url = `https://api.billecta.com/api/v1/creditors/${creditor}/debtors?search=test@example.com`;

  const results = {
    bearerRaw: await probe(url, { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' }),
    bearerDecoded: await probe(url, { Authorization: `Bearer ${decodedKey}`, 'Content-Type': 'application/json' }),
    xApiKeyRaw: await probe(url, { 'x-api-key': rawKey, 'Content-Type': 'application/json' }),
    xApiKeyDecoded: await probe(url, { 'x-api-key': decodedKey, 'Content-Type': 'application/json' }),
    basicRaw: await probe(url, { Authorization: `Basic ${Buffer.from(`${rawKey}:`).toString('base64')}`, 'Content-Type': 'application/json' }),
    basicDecoded: await probe(url, { Authorization: `Basic ${Buffer.from(`${decodedKey}:`).toString('base64')}`, 'Content-Type': 'application/json' }),
  };

  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
