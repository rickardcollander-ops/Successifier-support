import { PrismaClient } from '@prisma/client';

const OLD_DB_URL = "postgresql://neondb_owner:npg_WhB2Ibp7nqyP@ep-crimson-math-agxb86ws-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const NEW_DB_URL = "postgresql://neondb_owner:npg_GuEe9BOY3Srv@ep-rapid-bird-akvjmjl9.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require";

const oldDb = new PrismaClient({ datasources: { db: { url: OLD_DB_URL } } });
const newDb = new PrismaClient({ datasources: { db: { url: NEW_DB_URL } } });

async function migrate() {
  try {
    // 1. Get old tenants
    const tenants = await oldDb.tenant.findMany();
    console.log(`Found ${tenants.length} tenants`);

    for (const tenant of tenants) {
      await newDb.tenant.upsert({
        where: { subdomain: tenant.subdomain },
        update: { name: tenant.name },
        create: tenant,
      });
    }
    console.log('Tenants migrated');

    // 2. Knowledge base
    const kb = await oldDb.knowledgeBase.findMany();
    console.log(`Found ${kb.length} knowledge base entries`);
    for (const entry of kb) {
      try {
        await newDb.knowledgeBase.create({ data: entry });
      } catch (e) {
        if (e.code === 'P2002') {
          console.log(`  Skipping duplicate KB: ${entry.title}`);
        } else {
          console.error(`  Error KB ${entry.title}:`, e.message);
        }
      }
    }
    console.log('Knowledge base migrated');

    // 3. Tickets
    const tickets = await oldDb.ticket.findMany();
    console.log(`Found ${tickets.length} tickets`);
    for (const ticket of tickets) {
      try {
        await newDb.ticket.create({ data: ticket });
      } catch (e) {
        if (e.code === 'P2002') {
          console.log(`  Skipping duplicate ticket: ${ticket.subject}`);
        } else {
          console.error(`  Error ticket ${ticket.subject}:`, e.message);
        }
      }
    }
    console.log('Tickets migrated');

    // 4. Integrations
    const integrations = await oldDb.integration.findMany();
    console.log(`Found ${integrations.length} integrations`);
    for (const integration of integrations) {
      try {
        await newDb.integration.upsert({
          where: { tenantId_type: { tenantId: integration.tenantId, type: integration.type } },
          update: { credentials: integration.credentials, name: integration.name, isActive: integration.isActive },
          create: integration,
        });
      } catch (e) {
        console.error(`  Error integration ${integration.name}:`, e.message);
      }
    }
    console.log('Integrations migrated');

    // 5. Agents
    const agents = await oldDb.agent.findMany();
    console.log(`Found ${agents.length} agents`);
    for (const agent of agents) {
      try {
        await newDb.agent.create({ data: agent });
      } catch (e) {
        if (e.code === 'P2002') {
          console.log(`  Skipping duplicate agent: ${agent.email}`);
        } else {
          console.error(`  Error agent ${agent.email}:`, e.message);
        }
      }
    }
    console.log('Agents migrated');

    // 6. API Keys
    const apiKeys = await oldDb.apiKey.findMany();
    console.log(`Found ${apiKeys.length} API keys`);
    for (const key of apiKeys) {
      try {
        await newDb.apiKey.create({ data: key });
      } catch (e) {
        if (e.code === 'P2002') {
          console.log(`  Skipping duplicate API key: ${key.name}`);
        } else {
          console.error(`  Error API key ${key.name}:`, e.message);
        }
      }
    }
    console.log('API keys migrated');

    console.log('\n✅ Migration complete!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  }
}

migrate();
