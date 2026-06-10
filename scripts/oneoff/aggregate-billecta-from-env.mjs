import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const prisma = new PrismaClient();
const BILLECTA_API_BASE = 'https://api.billecta.com';

async function aggregateBillectaContext() {
  try {
    console.log('🔍 Starting Billecta context aggregation for all tickets...\n');

    // Get Billecta credentials from environment
    const apiKey = process.env.BILLECTA_API_KEY;
    const creditorPublicId = process.env.BILLECTA_CREDITOR_ID;

    if (!apiKey || !creditorPublicId) {
      console.error('❌ Missing BILLECTA_API_KEY or BILLECTA_CREDITOR_ID in .env.local');
      console.log('💡 Make sure these are set in your .env.local file');
      process.exit(1);
    }

    console.log(`✅ Using Billecta creditor: ${creditorPublicId}\n`);

    // Find tenant
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: 'doldadress' },
    });

    if (!tenant) {
      console.error('❌ Tenant not found');
      process.exit(1);
    }

    // Get all tickets
    const tickets = await prisma.ticket.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`📊 Found ${tickets.length} tickets\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const ticket of tickets) {
      try {
        const customerEmail = ticket.customerEmail.trim().toLowerCase();
        
        // Skip Billecta's own emails
        if (customerEmail === 'no-reply@billecta.com') {
          skipped++;
          continue;
        }

        console.log(`🔍 Checking ${customerEmail}...`);

        // Search for debtor by email
        const searchUrl = `${BILLECTA_API_BASE}/creditors/${creditorPublicId}/debtors?search=${encodeURIComponent(customerEmail)}`;
        const searchResponse = await fetch(searchUrl, {
          headers: {
            'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
            'Content-Type': 'application/json',
          },
        });

        if (!searchResponse.ok) {
          console.log(`⏭️  No Billecta data for ${customerEmail}`);
          skipped++;
          continue;
        }

        const debtors = await searchResponse.json();
        
        if (!debtors || debtors.length === 0) {
          console.log(`⏭️  No Billecta data for ${customerEmail}`);
          skipped++;
          continue;
        }

        const debtor = debtors[0];
        const debtorPublicId = debtor.DebtorPublicId;

        // Fetch invoices for this debtor
        const invoicesUrl = `${BILLECTA_API_BASE}/creditors/${creditorPublicId}/debtors/${debtorPublicId}/invoices`;
        const invoicesResponse = await fetch(invoicesUrl, {
          headers: {
            'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
            'Content-Type': 'application/json',
          },
        });

        let invoices = [];
        if (invoicesResponse.ok) {
          invoices = await invoicesResponse.json();
        }

        // Build Billecta context
        const billectaData = {
          debtorPublicId,
          debtorName: debtor.Name || null,
          invoices: invoices.map(inv => ({
            invoiceNumber: inv.InvoiceNumber,
            status: inv.State,
            amount: inv.TotalAmount,
            dueDate: inv.DueDate,
            isPaid: inv.State === 'Paid',
          })),
        };

        // Update ticket with Billecta context
        const existingContext = ticket.contextData || {};
        
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            contextData: {
              ...existingContext,
              billecta: billectaData,
            },
          },
        });

        console.log(`✅ Updated ticket #${ticket.id}: Found ${invoices.length} invoices`);
        updated++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`❌ Error processing ticket ${ticket.id}:`, error.message);
        errors++;
      }
    }

    console.log(`\n📊 Aggregation Summary:`);
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📝 Total: ${tickets.length}\n`);

  } catch (error) {
    console.error('❌ Aggregation failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

aggregateBillectaContext();
