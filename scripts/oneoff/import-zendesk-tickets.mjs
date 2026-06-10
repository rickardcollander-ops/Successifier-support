import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

const csvPath = 'C:\\Users\\cozm0\\Downloads\\export-2026-02-25-0940-20082570-33587755045650c345.csv\\export-2026-02-25-0940-20082570-33587755045650c345_1.csv';

async function importZendeskTickets() {
  try {
    console.log('📥 Reading Zendesk CSV export...\n');

    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`📊 Total records in CSV: ${records.length}\n`);

    // Find tenant
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: 'doldadress' },
    });

    if (!tenant) {
      console.error('❌ Tenant not found');
      process.exit(1);
    }

    // Filter for New (unassigned) or Open (assigned) tickets
    const ticketsToImport = records.filter(record => {
      const status = record.Status;
      const assignee = record.Assignee;
      
      // New tickets (not assigned)
      if (status === 'New' && !assignee) return true;
      
      // Open tickets that ARE assigned
      if (status === 'Open' && assignee) return true;
      
      return false;
    });

    console.log(`✅ Found ${ticketsToImport.length} tickets to import (New unassigned + Open assigned)\n`);

    let imported = 0;
    let skipped = 0;

    for (const record of ticketsToImport) {
      try {
        const zendeskId = record.Id;
        const subject = record.Subject || 'No Subject';
        const customerEmail = record['Requester email'];
        const customerName = record.Requester;
        const status = record.Status === 'New' ? 'new' : 'in_progress'; // Map Open to in_progress
        const createdAt = new Date(record['Created at']);
        const assignee = record.Assignee;

        // Check if already imported
        const existing = await prisma.ticket.findFirst({
          where: {
            tenantId: tenant.id,
            originalMessage: {
              contains: `[Zendesk ID: ${zendeskId}]`,
            },
          },
        });

        if (existing) {
          console.log(`⏭️  Skipping #${zendeskId} - already imported`);
          skipped++;
          continue;
        }

        // Create ticket
        await prisma.ticket.create({
          data: {
            tenantId: tenant.id,
            customerEmail,
            customerName,
            subject,
            originalMessage: `[Zendesk ID: ${zendeskId}]\n[Imported from Zendesk on ${new Date().toISOString()}]\n${assignee ? `[Assigned to: ${assignee}]` : '[Unassigned]'}\n\nOriginal ticket from Zendesk support system.`,
            status,
            priority: 'normal',
            createdAt,
          },
        });

        console.log(`✅ Imported #${zendeskId}: ${subject} (${customerEmail}) - Status: ${status}`);
        imported++;

      } catch (error) {
        console.error(`❌ Error importing ticket ${record.Id}:`, error.message);
      }
    }

    console.log(`\n📊 Import Summary:`);
    console.log(`   ✅ Imported: ${imported}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   📝 Total: ${ticketsToImport.length}\n`);

  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

importZendeskTickets();
