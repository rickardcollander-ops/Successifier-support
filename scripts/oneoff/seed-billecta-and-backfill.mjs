import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

// Manually load .env.local
try {
  const envContent = readFileSync('.env.local', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {}

const prisma = new PrismaClient();
const BILLECTA_BASE_URL = 'https://api.billecta.com';

const API_KEY = process.env.BILLECTA_API_KEY;
const CREDITOR_PUBLIC_ID = process.env.BILLECTA_CREDITOR_PUBLIC_ID;

if (!API_KEY || !CREDITOR_PUBLIC_ID) {
  console.error('Missing BILLECTA_API_KEY or BILLECTA_CREDITOR_PUBLIC_ID in env');
  process.exit(1);
}

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
    if (response.ok) return response.json();
    lastBody = (await response.text().catch(() => '')).slice(0, 300);
  }
  throw new Error(`Billecta API ${lastStatus}: ${lastBody}`);
}

async function getDebtorByEmail(email) {
  const debtors = await billectaRequest(`/v1/debtors/debtors/${CREDITOR_PUBLIC_ID}`, API_KEY);
  const normalizedEmail = email.toLowerCase().trim();
  const list = Array.isArray(debtors) ? debtors : [];
  return list.find((d) =>
    (d.Email || '').toLowerCase().trim() === normalizedEmail ||
    (d.ContactEmail || '').toLowerCase().trim() === normalizedEmail
  ) || null;
}

async function getBillectaContext(email) {
  const debtor = await getDebtorByEmail(email);
  if (!debtor?.DebtorPublicId) return null;

  let openInvoices = [];
  try {
    const open = await billectaRequest(`/v1/invoice/openbydebtor/${debtor.DebtorPublicId}`, API_KEY);
    openInvoices = Array.isArray(open) ? open : [];
  } catch { openInvoices = []; }

  let closedInvoices = [];
  try {
    const now = new Date();
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const from = yearAgo.toISOString().split('T')[0];
    const to = now.toISOString().split('T')[0];
    const closed = await billectaRequest(`/v1/invoice/closedbydebtor/${debtor.DebtorPublicId}?from=${from}&to=${to}`, API_KEY);
    closedInvoices = Array.isArray(closed) ? closed : [];
  } catch { closedInvoices = []; }

  const allInvoices = [...openInvoices, ...closedInvoices];

  return {
    creditorPublicId: CREDITOR_PUBLIC_ID,
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
      deliveryMethod: inv.DeliveryMethod || null,
    })),
  };
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'doldadress' } });
  if (!tenant) throw new Error("Tenant 'doldadress' not found");

  // 1. Upsert Billecta integration
  await prisma.integration.upsert({
    where: { tenantId_type: { tenantId: tenant.id, type: 'billecta' } },
    update: { credentials: { apiKey: API_KEY, creditorPublicId: CREDITOR_PUBLIC_ID }, isActive: true },
    create: { tenantId: tenant.id, type: 'billecta', name: 'Billecta', credentials: { apiKey: API_KEY, creditorPublicId: CREDITOR_PUBLIC_ID }, isActive: true },
  });
  console.log('Billecta integration created/updated.');

  // 2. Backfill all tickets
  const tickets = await prisma.ticket.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, customerEmail: true, subject: true },
  });

  console.log(`Backfilling ${tickets.length} tickets...`);

  for (const ticket of tickets) {
    try {
      const billecta = await getBillectaContext(ticket.customerEmail);
      if (!billecta) {
        console.log(`  SKIP | ${ticket.customerEmail} | no Billecta match`);
        continue;
      }

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { contextData: { billecta } },
      });
      console.log(`  OK   | ${ticket.customerEmail} | ${billecta.debtorName} | ${billecta.invoices.length} invoices`);
    } catch (err) {
      console.log(`  ERR  | ${ticket.customerEmail} | ${err.message}`);
    }
  }

  console.log('Done.');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
