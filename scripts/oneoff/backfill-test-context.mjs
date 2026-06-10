import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BILLECTA_BASE_URL = 'https://api.billecta.com';

function decodeBase64IfPossible(value) {
  try {
    const candidate = String(value || '').trim();
    if (!candidate || candidate.length < 20) return null;
    if (!/^[A-Za-z0-9+/=]+$/.test(candidate) || candidate.length % 4 !== 0) return null;

    const decoded = Buffer.from(candidate, 'base64').toString('utf8').trim();
    if (!decoded || decoded === candidate || decoded.length < 10) return null;
    if (!/^[\x21-\x7E]+$/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function getApiKeyVariants(rawApiKey) {
  const variants = [];
  const seen = new Set();

  const add = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    variants.push(trimmed);
  };

  add(rawApiKey);
  const decodedOnce = decodeBase64IfPossible(rawApiKey);
  add(decodedOnce);
  const decodedTwice = decodedOnce ? decodeBase64IfPossible(decodedOnce) : null;
  add(decodedTwice);

  add(Buffer.from(String(rawApiKey || '').trim(), 'utf8').toString('base64'));
  if (decodedOnce) add(Buffer.from(decodedOnce, 'utf8').toString('base64'));

  return variants;
}

async function billectaRequest(endpoint, apiKey) {
  const keyVariants = getApiKeyVariants(apiKey);
  const authSchemes = ['Bearer', 'SecureToken'];
  let lastStatusText = 'Unauthorized';

  for (const variant of keyVariants) {
    for (const scheme of authSchemes) {
      const response = await fetch(`${BILLECTA_BASE_URL}${endpoint}`, {
        headers: {
          Authorization: `${scheme} ${variant}`,
          'Content-Type': 'application/json',
        },
      });

      lastStatusText = response.statusText || lastStatusText;
      if (response.ok) return response.json();
    }
  }

  throw new Error(`Billecta API error: ${lastStatusText}`);
}

async function getBillectaContext(email, credentials) {
  try {
    const debtorResponse = await billectaRequest(
      `/api/v1/creditors/${credentials.creditorPublicId}/debtors?search=${encodeURIComponent(email)}`,
      credentials.apiKey
    );

    const debtor = debtorResponse?.data?.[0];
    if (!debtor?.DebtorPublicId) return null;

    const invoicesResponse = await billectaRequest(
      `/api/v1/creditors/${credentials.creditorPublicId}/debtors/${debtor.DebtorPublicId}/invoices`,
      credentials.apiKey
    );

    return {
      creditorPublicId: credentials.creditorPublicId,
      debtorPublicId: debtor.DebtorPublicId,
      invoices:
        invoicesResponse?.data?.map((inv) => ({
          id: inv.InvoicePublicId,
          number: inv.InvoiceNumber,
          status: inv.State,
          amount: inv.TotalAmount,
          dueDate: inv.DueDate,
          isPaid: inv.IsPaid,
        })) || [],
    };
  } catch (error) {
    console.error(`Billecta lookup failed for ${email}:`, error.message);
    return null;
  }
}

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { subdomain: 'doldadress' },
    select: { id: true },
  });

  if (!tenant) throw new Error("Tenant 'doldadress' not found");

  const billectaIntegration = await prisma.integration.findFirst({
    where: {
      tenantId: tenant.id,
      type: 'billecta',
      isActive: true,
    },
    select: { credentials: true },
  });

  if (!billectaIntegration?.credentials?.apiKey || !billectaIntegration?.credentials?.creditorPublicId) {
    throw new Error('No active Billecta integration with credentials found');
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      tenantId: tenant.id,
    },
    select: { id: true, customerEmail: true, contextData: true },
    orderBy: { createdAt: 'desc' },
  });

  const missingContextTickets = tickets.filter((ticket) => !ticket.contextData);
  const uniqueEmails = [...new Set(missingContextTickets.map((ticket) => ticket.customerEmail.toLowerCase().trim()))];

  console.log(`Found ${missingContextTickets.length} tickets missing context across ${uniqueEmails.length} unique emails.`);

  let updated = 0;
  let skipped = 0;

  for (const email of uniqueEmails) {
    const billecta = await getBillectaContext(email, billectaIntegration.credentials);

    if (!billecta) {
      skipped += missingContextTickets.filter((ticket) => ticket.customerEmail.toLowerCase().trim() === email).length;
      continue;
    }

    const result = await prisma.ticket.updateMany({
      where: {
        tenantId: tenant.id,
        customerEmail: {
          equals: email,
          mode: 'insensitive',
        },
      },
      data: { contextData: { billecta } },
    });

    updated += result.count;
    console.log(`Updated ${result.count} tickets for ${email}`);
  }

  console.log(`Done. Updated: ${updated}, skipped: ${skipped}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
