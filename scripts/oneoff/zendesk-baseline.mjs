// One-off: compute a "before our tool" baseline from a Zendesk CSV export and
// store it on ReportSettings, so the Rapporter page can compare current
// response/handling times against the Zendesk era and price the difference.
//
// Zendesk's CSV export of solved tickets typically carries the columns we need
// already (names vary slightly between exports / locales):
//   - "First reply time (min)" or "First reply time in minutes"  → response
//   - "Full resolution time (min)" / "Agent wait time (min)"     → handling
// We read whichever of the known aliases exist, average over solved tickets,
// and upsert the result. Re-run any time with a fresher export to update it.
//
// Usage:
//   node scripts/oneoff/zendesk-baseline.mjs <path-to.csv> [subdomain]
// Default subdomain: doldadress.

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

const csvPath = process.argv[2];
const subdomain = process.argv[3] || 'doldadress';

// Column-name aliases we'll accept for each metric (case-insensitive, trimmed).
const FIRST_REPLY_ALIASES = [
  'first reply time (min)',
  'first reply time in minutes',
  'first reply time',
  'first response time (min)',
];
const RESOLUTION_ALIASES = [
  'full resolution time (min)',
  'full resolution time in minutes',
  'full resolution time',
  'resolution time (min)',
];

function pickColumn(record, aliases) {
  const keys = Object.keys(record);
  for (const alias of aliases) {
    const hit = keys.find((k) => k.trim().toLowerCase() === alias);
    if (hit) return hit;
  }
  return null;
}

function average(nums) {
  const valid = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

async function run() {
  if (!csvPath) {
    console.error('Usage: node scripts/oneoff/zendesk-baseline.mjs <path-to.csv> [subdomain]');
    process.exit(1);
  }

  console.log(`📥 Reading ${csvPath} ...`);
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(fileContent, { columns: true, skip_empty_lines: true });
  console.log(`📊 ${records.length} rows in CSV`);

  if (records.length === 0) {
    console.error('❌ No rows found');
    process.exit(1);
  }

  const replyCol = pickColumn(records[0], FIRST_REPLY_ALIASES);
  const resolutionCol = pickColumn(records[0], RESOLUTION_ALIASES);

  if (!replyCol && !resolutionCol) {
    console.error('❌ Could not find a first-reply or resolution-time column.');
    console.error('   Available columns:', Object.keys(records[0]).join(', '));
    process.exit(1);
  }
  console.log(`   First-reply column:  ${replyCol || '(none)'}`);
  console.log(`   Resolution column:   ${resolutionCol || '(none)'}`);

  const replyMinutes = replyCol ? records.map((r) => parseFloat(r[replyCol])) : [];
  const resolutionMinutes = resolutionCol ? records.map((r) => parseFloat(r[resolutionCol])) : [];

  const avgReplyMin = average(replyMinutes);
  const avgResolutionMin = average(resolutionMinutes);

  // Response time is shown in hours in the app; handling time in minutes.
  const baselineResponseHours = avgReplyMin != null ? Math.round((avgReplyMin / 60) * 10) / 10 : null;
  // Prefer resolution time for the "handling" baseline; fall back to first
  // reply if resolution is missing from the export.
  const baselineHandlingMinutes =
    avgResolutionMin != null ? Math.round(avgResolutionMin)
    : avgReplyMin != null ? Math.round(avgReplyMin)
    : null;

  const tenant = await prisma.tenant.findUnique({ where: { subdomain } });
  if (!tenant) {
    console.error(`❌ Tenant "${subdomain}" not found`);
    process.exit(1);
  }

  await prisma.reportSettings.upsert({
    where: { tenantId: tenant.id },
    update: { baselineResponseHours, baselineHandlingMinutes },
    create: { tenantId: tenant.id, baselineResponseHours, baselineHandlingMinutes },
  });

  console.log('\n✅ Baseline saved:');
  console.log(`   Svarstid (baslinje):        ${baselineResponseHours ?? '–'} h`);
  console.log(`   Handläggningstid (baslinje): ${baselineHandlingMinutes ?? '–'} min`);
  console.log('\n   (Timkostnaden sätter du under "Värde & ROI" på Rapporter-sidan.)');
}

run()
  .catch((e) => {
    console.error('❌ Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
