import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function triggerContextAggregation() {
  try {
    console.log('🔍 Triggering Billecta context aggregation for all tickets...\n');

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

        console.log(`🔍 Triggering context for ticket #${ticket.id} (${customerEmail})...`);

        // Call the customer-history API endpoint which aggregates context
        const response = await fetch(`http://localhost:3001/api/tickets/${ticket.id}/customer-history`);

        if (response.ok) {
          const data = await response.json();
          
          if (data.billecta) {
            console.log(`✅ Updated ticket #${ticket.id}: Found ${data.billecta.invoices || 0} invoices`);
            updated++;
          } else {
            console.log(`⏭️  No Billecta data for ${customerEmail}`);
            skipped++;
          }
        } else {
          console.log(`⚠️  API error for ticket #${ticket.id}: ${response.status}`);
          skipped++;
        }

        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 300));

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

triggerContextAggregation();
