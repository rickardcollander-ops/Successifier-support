import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

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

const API_KEY = process.env.BILLECTA_API_KEY;
const CREDITOR_PUBLIC_ID = process.env.BILLECTA_CREDITOR_PUBLIC_ID;
const BASE = 'https://api.billecta.com';

async function billectaGet(endpoint) {
  const raw = API_KEY.trim();
  const encoded = Buffer.from(raw, 'utf8').toString('base64');
  for (const token of [encoded, raw]) {
    const res = await fetch(`${BASE}${endpoint}`, {
      headers: { Authorization: `SecureToken ${token}`, Accept: 'application/json' },
    });
    if (res.ok) return res.json();
  }
  throw new Error(`All auth variants failed for ${endpoint}`);
}

async function main() {
  const debtors = await billectaGet(`/v1/debtors/debtors/${CREDITOR_PUBLIC_ID}`);
  
  // Pick first debtor with a known email
  const debtor = debtors.find(d => (d.Email || '').toLowerCase().includes('hotmail') || (d.Email || '').toLowerCase().includes('gmail'));
  if (!debtor) { console.log('No debtor found'); return; }
  
  console.log('=== DEBTOR FIELDS ===');
  console.log(Object.keys(debtor).join(', '));
  
  const openInvoices = await billectaGet(`/v1/invoice/openbydebtor/${debtor.DebtorPublicId}`);
  
  if (openInvoices.length > 0) {
    console.log('\n=== OPEN INVOICE SAMPLE (all fields) ===');
    console.log(JSON.stringify(openInvoices[0], null, 2));
  }

  const now = new Date();
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const closedInvoices = await billectaGet(`/v1/invoice/closedbydebtor/${debtor.DebtorPublicId}?from=${yearAgo.toISOString().split('T')[0]}&to=${now.toISOString().split('T')[0]}`);
  
  if (closedInvoices.length > 0) {
    console.log('\n=== CLOSED INVOICE SAMPLE (all fields) ===');
    console.log(JSON.stringify(closedInvoices[0], null, 2));
  }
}

main().catch(console.error);
