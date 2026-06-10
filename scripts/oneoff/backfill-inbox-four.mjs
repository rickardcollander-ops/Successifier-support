import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BILLECTA_BASE_URL = 'https://api.billecta.com';
const ZENDESK_IMPORT_MARKER = '[Zendesk Import Source:';

/**
 * Per Billecta docs: SecureToken must be base64-encoded in the Authorization header.
 * The stored key may be raw or already encoded — we try both variants.
 */
function getAuthHeaderVariants(secureToken) {
  const raw = secureToken.trim();
  const encoded = Buffer.from(raw, 'utf8').toString('base64');
  const variants = new Set([encoded, raw]);
  return [...variants].map((token) => ({
    Authorization: `SecureToken ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }));
}

async function billectaRequest(endpoint, secureToken) {
  const headerVariants = getAuthHeaderVariants(secureToken);
  let lastStatus = 0;
  let lastBody = '';

  for (const headers of headerVariants) {
    const response = await fetch(`${BILLECTA_BASE_URL}${endpoint}`, { headers });
    lastStatus = response.status;

    if (response.ok) {
      return response.json();
    }

    lastBody = (await response.text().catch(() => '')).slice(0, 300);
  }

  throw new Error(`Billecta API ${lastStatus}: ${lastBody}`);
}

/**
 * Billecta has NO search-by-email endpoint.
 * GET /v1/debtors/debtors/{creditorPublicId} returns all debtors.
 * We filter client-side by Email or ContactEmail.
 */
async function getDebtorByEmail(email, credentials) {
  const debtors = await billectaRequest(
    `/v1/debtors/debtors/${credentials.creditorPublicId}`,
    credentials.apiKey
  );

  const normalizedEmail = email.toLowerCase().trim();
  const list = Array.isArray(debtors) ? debtors : [];

  return (
    list.find(
      (d) =>
        (d.Email || '').toLowerCase().trim() === normalizedEmail ||
        (d.ContactEmail || '').toLowerCase().trim() === normalizedEmail
    ) || null
  );
}

async function getBillectaContext(email, credentials) {
  const debtor = await getDebtorByEmail(email, credentials);
  if (!debtor?.DebtorPublicId) return null;

  // Open invoices: GET /v1/invoice/openbydebtor/{debtorPublicId}
  let openInvoices = [];
  try {
    const open = await billectaRequest(
      `/v1/invoice/openbydebtor/${debtor.DebtorPublicId}`,
      credentials.apiKey
    );
    openInvoices = Array.isArray(open) ? open : [];
  } catch {
    openInvoices = [];
  }

  // Closed invoices (last year): GET /v1/invoice/closedbydebtor/{debtorPublicId}?from=...&to=...
  let closedInvoices = [];
  try {
    const now = new Date();
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const from = yearAgo.toISOString().split('T')[0];
    const to = now.toISOString().split('T')[0];
    const closed = await billectaRequest(
      `/v1/invoice/closedbydebtor/${debtor.DebtorPublicId}?from=${from}&to=${to}`,
      credentials.apiKey
    );
    closedInvoices = Array.isArray(closed) ? closed : [];
  } catch {
    closedInvoices = [];
  }

  const allInvoices = [...openInvoices, ...closedInvoices];

  return {
    creditorPublicId: credentials.creditorPublicId,
    debtorPublicId: debtor.DebtorPublicId,
    debtorName: debtor.Name || null,
    debtorOrgNo: debtor.OrgNo || null,
    invoices: allInvoices.map((inv) => ({
      id: inv.ActionPublicId,
      number: inv.InvoiceNumber,
      status: inv.Stage,
      amount: inv.CurrentAmount?.ValueForView ?? inv.InvoicedAmount?.ValueForView ?? null,
      dueDate: inv.DueDate,
      isPaid: inv.Stage === 'Completed',
    })),
  };
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

  const inboxTickets = await prisma.ticket.findMany({
    where: {
      tenantId: tenant.id,
      NOT: {
        originalMessage: {
          contains: ZENDESK_IMPORT_MARKER,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 4,
    select: {
      id: true,
      customerEmail: true,
      subject: true,
      contextData: true,
      createdAt: true,
    },
  });

  console.log(`Processing ${inboxTickets.length} inbox tickets (latest 4).`);

  for (const ticket of inboxTickets) {
    try {
      const billecta = await getBillectaContext(ticket.customerEmail, billectaIntegration.credentials);

      if (!billecta) {
        console.log(`SKIPPED | ${ticket.id} | ${ticket.customerEmail} | no Billecta match`);
        continue;
      }

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          contextData: {
            ...(ticket.contextData || {}),
            billecta,
          },
        },
      });

      console.log(`UPDATED | ${ticket.id} | ${ticket.customerEmail} | invoices=${billecta.invoices.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.log(`ERROR   | ${ticket.id} | ${ticket.customerEmail} | ${message}`);
    }
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
