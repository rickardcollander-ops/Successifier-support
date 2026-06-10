import { PrismaClient } from '@prisma/client';

const OLD_DB_URL = "postgresql://neondb_owner:npg_WhB2Ibp7nqyP@ep-crimson-math-agxb86ws-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const oldDb = new PrismaClient({ datasources: { db: { url: OLD_DB_URL } } });

async function check() {
  try {
    // List all tables
    const tables = await oldDb.$queryRaw`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    console.log('Tables in old DB:');
    for (const t of tables) {
      const count = await oldDb.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "${t.table_name}"`);
      console.log(`  ${t.table_name}: ${count[0].count} rows`);
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await oldDb.$disconnect();
  }
}

check();
