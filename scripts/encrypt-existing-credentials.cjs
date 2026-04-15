const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const DB_URL = "postgresql://neondb_owner:npg_GuEe9BOY3Srv@ep-rapid-bird-akvjmjl9.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require";
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

function encryptJSON(data) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const text = JSON.stringify(data);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function isEncrypted(data) {
  if (typeof data !== 'string') return false;
  const parts = data.split(':');
  return parts.length === 3 && parts[0].length === 32 && parts[1].length === 32;
}

async function main() {
  console.log('=== Encrypting Existing Integration Credentials ===\n');
  
  const integrations = await db.integration.findMany();
  console.log(`Found ${integrations.length} integrations\n`);
  
  let encrypted = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const integration of integrations) {
    try {
      const credentialsStr = typeof integration.credentials === 'string'
        ? integration.credentials
        : JSON.stringify(integration.credentials);
      
      // Skip if already encrypted
      if (isEncrypted(credentialsStr)) {
        console.log(`  ⊘ ${integration.type} - Already encrypted`);
        skipped++;
        continue;
      }
      
      // Encrypt credentials
      const encryptedCreds = encryptJSON(integration.credentials);
      
      await db.integration.update({
        where: { id: integration.id },
        data: { credentials: encryptedCreds },
      });
      
      console.log(`  ✓ ${integration.type} - Encrypted`);
      encrypted++;
    } catch (error) {
      console.error(`  ✗ ${integration.type} - Error: ${error.message}`);
      errors++;
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Encrypted: ${encrypted}`);
  console.log(`Skipped (already encrypted): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`\n✅ Migration complete!`);
  
  await db.$disconnect();
}

main().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
