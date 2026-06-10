import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function removeDuplicateTickets() {
  try {
    console.log('🔍 Searching for duplicate tickets...\n');

    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: 'doldadress' },
    });

    if (!tenant) {
      console.error('❌ Tenant not found');
      process.exit(1);
    }

    // Get all tickets
    const allTickets = await prisma.ticket.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'asc' }, // Keep oldest
    });

    console.log(`📊 Total tickets: ${allTickets.length}\n`);

    // Group by subject + customerEmail to find duplicates
    const ticketGroups = new Map();
    
    for (const ticket of allTickets) {
      const key = `${ticket.subject}|${ticket.customerEmail}`;
      if (!ticketGroups.has(key)) {
        ticketGroups.set(key, []);
      }
      ticketGroups.get(key).push(ticket);
    }

    // Find groups with duplicates
    const duplicateGroups = Array.from(ticketGroups.values()).filter(group => group.length > 1);
    
    console.log(`🔍 Found ${duplicateGroups.length} groups with duplicates\n`);

    if (duplicateGroups.length === 0) {
      console.log('✅ No duplicates found');
      return;
    }

    let totalDuplicates = 0;
    const ticketsToDelete = [];

    for (const group of duplicateGroups) {
      // Keep the first (oldest) ticket, delete the rest
      const [keep, ...duplicates] = group;
      totalDuplicates += duplicates.length;
      
      console.log(`📧 "${keep.subject}" (${keep.customerEmail})`);
      console.log(`   Keeping: ${keep.id} (${keep.createdAt.toISOString()})`);
      console.log(`   Deleting ${duplicates.length} duplicate(s):`);
      
      for (const dup of duplicates) {
        console.log(`   - ${dup.id} (${dup.createdAt.toISOString()})`);
        ticketsToDelete.push(dup.id);
      }
      console.log('');
    }

    console.log(`\n⚠️  WARNING: About to delete ${totalDuplicates} duplicate tickets!`);
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('🗑️  Deleting duplicates...\n');

    const result = await prisma.ticket.deleteMany({
      where: {
        id: { in: ticketsToDelete },
      },
    });

    console.log(`✅ Successfully deleted ${result.count} duplicate tickets\n`);
    console.log(`📊 Remaining tickets: ${allTickets.length - result.count}\n`);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

removeDuplicateTickets();
