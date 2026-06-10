import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupNonInboxTickets() {
  try {
    console.log('🔍 Searching for tickets to clean up...\n');

    // Find tenant
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: 'doldadress' },
    });

    if (!tenant) {
      console.error('❌ Tenant not found');
      process.exit(1);
    }

    // Get tickets created in the last 24 hours (likely the problematic ones)
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - 24);

    const recentTickets = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        createdAt: {
          gte: cutoffDate,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`📊 Found ${recentTickets.length} tickets created in the last 24 hours\n`);

    if (recentTickets.length === 0) {
      console.log('✅ No tickets to clean up');
      return;
    }

    // Show sample of tickets
    console.log('Sample of tickets to be deleted:');
    recentTickets.slice(0, 10).forEach((ticket, i) => {
      console.log(`  ${i + 1}. ${ticket.subject} (${ticket.customerEmail}) - ${ticket.createdAt.toISOString()}`);
    });

    if (recentTickets.length > 10) {
      console.log(`  ... and ${recentTickets.length - 10} more\n`);
    }

    console.log('\n⚠️  WARNING: This will delete all tickets created in the last 24 hours!');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('🗑️  Deleting tickets...\n');

    const result = await prisma.ticket.deleteMany({
      where: {
        tenantId: tenant.id,
        createdAt: {
          gte: cutoffDate,
        },
      },
    });

    console.log(`✅ Successfully deleted ${result.count} tickets\n`);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupNonInboxTickets();
