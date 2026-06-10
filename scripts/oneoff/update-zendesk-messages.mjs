import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

const jsonPath = 'C:\\Users\\cozm0\\Downloads\\json-export-temp\\export-2026-02-25-0944-20082570-3358792057576213e3_1.json';

async function updateZendeskMessages() {
  try {
    console.log('📥 Reading Zendesk JSON export...\n');

    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
    
    // Parse NDJSON (newline-delimited JSON)
    const lines = fileContent.trim().split('\n');
    const tickets = lines.map(line => JSON.parse(line));

    console.log(`📊 Total tickets in JSON: ${tickets.length}\n`);

    // Find tenant
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: 'doldadress' },
    });

    if (!tenant) {
      console.error('❌ Tenant not found');
      process.exit(1);
    }

    let updated = 0;
    let notFound = 0;

    for (const ticket of tickets) {
      try {
        const zendeskId = ticket.id.toString();
        const description = ticket.description || '';
        const comments = ticket.comments || [];

        // Find existing ticket by Zendesk ID
        const existingTicket = await prisma.ticket.findFirst({
          where: {
            tenantId: tenant.id,
            originalMessage: {
              contains: `[Zendesk ID: ${zendeskId}]`,
            },
          },
        });

        if (!existingTicket) {
          notFound++;
          continue;
        }

        // Build full conversation history
        let fullMessage = `[Zendesk ID: ${zendeskId}]\n[Imported from Zendesk on ${new Date().toISOString()}]\n\n`;
        fullMessage += `=== ORIGINAL MESSAGE ===\n${description}\n\n`;

        // Add all comments/replies
        if (comments.length > 0) {
          fullMessage += `=== CONVERSATION HISTORY (${comments.length} messages) ===\n\n`;
          
          comments.forEach((comment, index) => {
            const commentDate = new Date(comment.created_at).toLocaleString('sv-SE');
            const authorName = comment.author_id ? `User ${comment.author_id}` : 'Unknown';
            const body = comment.plain_body || comment.body || '';
            const isPublic = comment.public ? 'Public' : 'Internal';
            
            fullMessage += `--- Message ${index + 1} (${commentDate}) [${isPublic}] ---\n`;
            fullMessage += `${body}\n\n`;
          });
        }

        // Update with full conversation
        await prisma.ticket.update({
          where: { id: existingTicket.id },
          data: {
            originalMessage: fullMessage,
          },
        });

        console.log(`✅ Updated #${zendeskId}: ${ticket.subject} (${comments.length} messages)`);
        updated++;

      } catch (error) {
        console.error(`❌ Error updating ticket ${ticket.id}:`, error.message);
      }
    }

    console.log(`\n📊 Update Summary:`);
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⏭️  Not found: ${notFound}`);
    console.log(`   📝 Total processed: ${tickets.length}\n`);

  } catch (error) {
    console.error('❌ Update failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

updateZendeskMessages();
