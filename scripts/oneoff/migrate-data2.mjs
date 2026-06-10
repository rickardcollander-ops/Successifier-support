import { PrismaClient } from '@prisma/client';

const OLD_DB_URL = "postgresql://neondb_owner:npg_WhB2Ibp7nqyP@ep-crimson-math-agxb86ws-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const NEW_DB_URL = "postgresql://neondb_owner:npg_GuEe9BOY3Srv@ep-rapid-bird-akvjmjl9.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require";

const oldDb = new PrismaClient({ datasources: { db: { url: OLD_DB_URL } } });
const newDb = new PrismaClient({ datasources: { db: { url: NEW_DB_URL } } });

async function migrate() {
  try {
    // Get old tenant ID
    const oldTenant = await oldDb.tenant.findFirst({ where: { subdomain: 'doldadress' } });
    const newTenant = await newDb.tenant.findFirst({ where: { subdomain: 'doldadress' } });
    
    if (!oldTenant || !newTenant) {
      console.error('Tenant not found!', { old: oldTenant?.id, new: newTenant?.id });
      return;
    }
    
    console.log(`Old tenant ID: ${oldTenant.id}`);
    console.log(`New tenant ID: ${newTenant.id}`);

    // Tickets - remap tenantId
    const tickets = await oldDb.ticket.findMany();
    console.log(`\nFound ${tickets.length} tickets`);
    for (const ticket of tickets) {
      try {
        await newDb.ticket.create({
          data: {
            ...ticket,
            tenantId: newTenant.id,
          },
        });
        console.log(`  ✓ ${ticket.subject}`);
      } catch (e) {
        if (e.code === 'P2002') {
          console.log(`  Skipping duplicate: ${ticket.subject}`);
        } else {
          console.error(`  ✗ ${ticket.subject}: ${e.message}`);
        }
      }
    }

    // Knowledge base
    const kb = await oldDb.knowledgeBase.findMany();
    console.log(`\nFound ${kb.length} knowledge base entries`);
    for (const entry of kb) {
      try {
        await newDb.knowledgeBase.create({
          data: {
            ...entry,
            tenantId: newTenant.id,
          },
        });
        console.log(`  ✓ ${entry.title}`);
      } catch (e) {
        if (e.code === 'P2002') {
          console.log(`  Skipping duplicate: ${entry.title}`);
        } else {
          console.error(`  ✗ ${entry.title}: ${e.message}`);
        }
      }
    }

    // Integrations
    const integrations = await oldDb.integration.findMany();
    console.log(`\nFound ${integrations.length} integrations`);
    for (const integration of integrations) {
      try {
        await newDb.integration.upsert({
          where: { tenantId_type: { tenantId: newTenant.id, type: integration.type } },
          update: { credentials: integration.credentials, name: integration.name, isActive: integration.isActive },
          create: {
            ...integration,
            tenantId: newTenant.id,
          },
        });
        console.log(`  ✓ ${integration.name}`);
      } catch (e) {
        console.error(`  ✗ ${integration.name}: ${e.message}`);
      }
    }

    // Agents
    const agents = await oldDb.agent.findMany();
    console.log(`\nFound ${agents.length} agents`);
    for (const agent of agents) {
      try {
        await newDb.agent.create({
          data: {
            ...agent,
            tenantId: newTenant.id,
          },
        });
        console.log(`  ✓ ${agent.email}`);
      } catch (e) {
        if (e.code === 'P2002') {
          console.log(`  Skipping duplicate: ${agent.email}`);
        } else {
          console.error(`  ✗ ${agent.email}: ${e.message}`);
        }
      }
    }

    // API Keys
    const apiKeys = await oldDb.apiKey.findMany();
    console.log(`\nFound ${apiKeys.length} API keys`);
    for (const key of apiKeys) {
      try {
        await newDb.apiKey.create({
          data: {
            ...key,
            tenantId: newTenant.id,
          },
        });
        console.log(`  ✓ ${key.name}`);
      } catch (e) {
        if (e.code === 'P2002') {
          console.log(`  Skipping duplicate: ${key.name}`);
        } else {
          console.error(`  ✗ ${key.name}: ${e.message}`);
        }
      }
    }

    console.log('\n✅ Migration complete!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}

migrate();
