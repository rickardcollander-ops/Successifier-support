// Load env the same way the rest of the scripts do, with a couple of fallbacks.
// Wrapped in try/catch so the script also runs with a bare `node` + env var,
// even if dotenv isn't installed in node_modules.
try {
  const dotenvMod = await import('dotenv');
  const dotenv = dotenvMod.default || dotenvMod;
  dotenv.config({ path: '.env.local' });
  dotenv.config({ path: '.env' });
} catch { /* dotenv optional */ }

/**
 * Diagnose why the "Resend – E-posthistorik" card shows fewer emails than the
 * Resend dashboard. This calls the SAME endpoint lib/integrations/resend.ts
 * uses (GET /emails?limit=100, which is what `resend.emails.list({limit:100})`
 * does under the hood) and shows, step by step, what our client-side filters
 * (7-day window + recipient match) drop.
 *
 * No npm install needed — uses plain fetch.
 *
 * Usage:
 *   RESEND_API_KEY=re_xxx node scripts/diagnose-resend.mjs a_essa@hotmail.com [lookbackDays]
 */

const apiKey = process.env.RESEND_API_KEY;
const targetEmail = (process.argv[2] || 'a_essa@hotmail.com').toLowerCase().trim();
const lookbackDays = Number(process.argv[3] || 7);

if (!apiKey) {
  console.error('❌ Missing RESEND_API_KEY (env var or .env/.env.local).');
  console.error('   Run: RESEND_API_KEY=re_xxx node scripts/diagnose-resend.mjs a_essa@hotmail.com');
  process.exit(1);
}

const fmt = (d) => (d ? new Date(d).toISOString() : '(no date)');

async function main() {
  console.log(`🔑 API key: ${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`);
  console.log(`🎯 Target:  ${targetEmail}`);
  console.log(`📅 Lookback: ${lookbackDays} days (cutoff = ${fmt(Date.now() - lookbackDays * 864e5)})\n`);

  // ---- 1. Raw API call (equivalent to resend.ts:35) ----
  const res = await fetch('https://api.resend.com/emails?limit=100', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const bodyText = await res.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { body = bodyText; }

  console.log(`🌐 HTTP ${res.status} ${res.statusText}`);
  if (!res.ok) {
    console.error('❌ Resend API error body:', body);
    process.exit(1);
  }

  // Resend v6 returns { data: [...] } or { object:'list', data:[...] }
  const emailList = Array.isArray(body) ? body
    : Array.isArray(body?.data) ? body.data
    : Array.isArray(body?.data?.data) ? body.data.data
    : [];

  console.log(`📦 RAW: list endpoint returned ${emailList.length} item(s) total.`);
  console.log(`   (top-level keys: ${body && typeof body === 'object' ? Object.keys(body).join(', ') : typeof body})\n`);

  if (emailList.length === 0) {
    console.log('⚠️  The list endpoint returned no items. Common causes:');
    console.log('   - This API key has no sending history (wrong key / wrong account)');
    console.log('   - emails.list not enabled / paginated differently for this account');
    console.log('   Raw body for inspection:');
    console.log(JSON.stringify(body, null, 2).slice(0, 2000));
    return;
  }

  // ---- 2. Show every item the API gave us ----
  const sorted = [...emailList].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  console.log('── All items from the API (newest first) ──');
  for (const e of sorted) {
    const to = Array.isArray(e.to) ? e.to.join(', ') : e.to;
    console.log(`  • ${fmt(e.created_at)}  to=${to}  from=${e.from}  subj="${e.subject}"  status=${e.last_event || e.status || '?'}`);
  }
  console.log('');

  // ---- 3. Apply our filters one at a time ----
  const cutoff = Date.now() - lookbackDays * 864e5;

  const afterDate = sorted.filter((e) => {
    const created = e.created_at ? new Date(e.created_at).getTime() : 0;
    return !(created && created < cutoff);
  });
  console.log(`🕒 After 7-day date filter:    ${afterDate.length} / ${sorted.length}`);

  const matchRecipient = (e) => {
    const toAddresses = Array.isArray(e.to) ? e.to : [e.to].filter(Boolean);
    const fromStr = typeof e.from === 'string' ? e.from : '';
    return toAddresses.some((a) => String(a).toLowerCase().includes(targetEmail)) ||
           fromStr.toLowerCase().includes(targetEmail);
  };

  const afterRecipient = afterDate.filter(matchRecipient);
  console.log(`👤 After recipient filter:     ${afterRecipient.length} / ${afterDate.length}`);

  const recipientAnyDate = sorted.filter(matchRecipient);
  console.log(`📨 Match recipient (any date): ${recipientAnyDate.length}\n`);

  console.log(`✅ FINAL (what the app stores as emailsSent): ${afterRecipient.length}`);
  for (const e of afterRecipient) console.log(`     - ${fmt(e.created_at)}  "${e.subject}"`);

  // ---- 4. Verdict ----
  console.log('\n── Diagnosis ──');
  if (recipientAnyDate.length > afterRecipient.length) {
    console.log(`⛔ ${recipientAnyDate.length - afterRecipient.length} email(s) to ${targetEmail} exist but fall OUTSIDE the ${lookbackDays}-day window.`);
  }
  if (recipientAnyDate.length === 0 && emailList.length > 0) {
    console.log(`⛔ API returned emails but NONE match ${targetEmail}. Likely a different API key/account than the dashboard, or 'to' is an object rather than a string.`);
  }
  if (emailList.length < 5) {
    console.log(`⚠️  Only ${emailList.length} item(s) total from the API — fewer than the dashboard. Possible pagination/scope limit of the list endpoint for this key.`);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
