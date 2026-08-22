// Onboard a NEW customer (tenant) on the shared multi-tenant deployment.
//
// Creates the Tenant row with its runtime settings and (optionally) the
// customer's first admin user, so they can sign in with Google right away.
// All configuration lives in Tenant.settings (see lib/products/types.ts for
// the shape) — no code changes or redeploys per customer.
//
// Usage:
//   node scripts/create-tenant.js <subdomain> "<Display name>" \
//     [--settings path/to/settings.json] \
//     [--admin admin@customer.com] \
//     [--domain customer.com] \
//     [--auth google|resend]
//
// Examples:
//   node scripts/create-tenant.js acme "Acme AB" --admin anna@acme.se --domain acme.se
//   node scripts/create-tenant.js acme "Acme AB" --settings acme-settings.json
//
// The tenant is then reachable on https://<subdomain>.<TENANT_ROOT_DOMAIN>
// and manageable via the superadmin API (/api/admin/tenants/<id>).
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--settings' || a === '--admin' || a === '--domain' || a === '--auth') {
      flags[a.slice(2)] = argv[++i];
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const subdomain = (positional[0] || '').trim().toLowerCase();
  const name = (positional[1] || '').trim();

  if (!SUBDOMAIN_RE.test(subdomain) || !name) {
    console.error('Usage: node scripts/create-tenant.js <subdomain> "<Display name>" [--settings file.json] [--admin email] [--domain customer.com] [--auth google|resend]');
    process.exit(1);
  }

  let settings = {};
  if (flags.settings) {
    settings = JSON.parse(fs.readFileSync(flags.settings, 'utf8'));
  }
  if (flags.domain) {
    const domain = flags.domain.trim().toLowerCase();
    settings.allowedDomains = Array.from(new Set([...(settings.allowedDomains || []), domain]));
  }
  if (flags.admin) {
    const admin = flags.admin.trim().toLowerCase();
    settings.adminEmails = Array.from(new Set([...(settings.adminEmails || []), admin]));
  }
  // Which sign-in method the customer gets. Google unless told otherwise;
  // 'resend' onboards a customer who runs neither Google nor Microsoft
  // straight onto magic-link sign-in.
  if (flags.auth) {
    const auth = flags.auth.trim().toLowerCase();
    if (!['google', 'resend'].includes(auth)) {
      console.error(`Unknown --auth "${auth}". Valid values: google, resend.`);
      process.exit(1);
    }
    settings.authProviders = [auth];
  }
  settings.authProviders = settings.authProviders || ['google'];
  // Sensible branding defaults derived from the display name; everything is
  // editable later via the superadmin tenant API.
  settings.displayName = settings.displayName || name;
  settings.brandName = settings.brandName || name;
  settings.supportName = settings.supportName || `${name} Support`;
  settings.fromName = settings.fromName || settings.supportName;

  const existing = await prisma.tenant.findUnique({ where: { subdomain } });
  if (existing) {
    console.error(`Tenant "${subdomain}" already exists (id=${existing.id}). Use the admin API to update it.`);
    process.exit(1);
  }

  // New customers start on a 14-day free trial (platform billing).
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const tenant = await prisma.tenant.create({
    data: { subdomain, name, settings, trialEndsAt },
  });
  console.log(`Tenant created: id=${tenant.id} subdomain=${tenant.subdomain} name="${tenant.name}"`);

  if (flags.admin) {
    const email = flags.admin.trim().toLowerCase();
    const user = await prisma.user.upsert({
      where: { email },
      update: { tenantId: tenant.id, role: 'admin' },
      create: {
        email,
        role: 'admin',
        tenantId: tenant.id,
        status: 'invited',
        invitedAt: new Date(),
      },
    });
    const how = settings.authProviders.includes('resend') ? 'a magic link' : 'Google';
    console.log(`Admin user ready: ${user.email} (role=admin) — can sign in with ${how} immediately.`);
  }

  const rootDomain = process.env.TENANT_ROOT_DOMAIN || 'successifier.app';
  console.log(`\nDone! The tenant is served at: https://${subdomain}.${rootDomain}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
