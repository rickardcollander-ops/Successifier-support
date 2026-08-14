import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

// Static regression guard: every API route must enforce auth itself.
// The middleware deliberately lets any request with an Authorization or
// X-API-Key header through to the route (it can't validate keys in the
// edge runtime), so a route without its own guard is effectively public.
// This is exactly how /api/tickets/[id]/send shipped without auth once —
// never again.

const ROOT = join(__dirname, '..');

// Routes that are allowed to skip the lib/api-auth guards, with the reason.
const ALLOWLIST: Record<string, string> = {
  'app/api/auth/[...nextauth]/route.ts': 'NextAuth handler — must be public',
  // Public help center: read-only endpoints that intentionally serve
  // unauthenticated visitors. They expose ONLY published, public articles and
  // hard-exclude auto-learned (PII) content via lib/services/public-kb.ts, and
  // are rate-limited. See KNOWLEDGE_BASE_INTEGRATION.md.
  'app/api/public/kb/categories/route.ts': 'Public help center — read-only, published content only',
  'app/api/public/kb/articles/route.ts': 'Public help center — read-only, published content only',
  'app/api/public/kb/articles/[slug]/route.ts': 'Public help center — read-only, published content only',
  'app/api/public/kb/articles/[slug]/feedback/route.ts': 'Public help center — anonymous helpful/unhelpful vote, rate-limited',
  'app/api/public/kb/search/route.ts': 'Public help center — read-only search, published content only',
  'app/api/public/kb/chat/route.ts': 'Public help center — AI chatbot grounded only in published, public articles via lib/services/public-kb.ts; rate-limited',
  'app/api/public/kb/config/route.ts': 'Public help center — read-only appearance/chat UI config (safe subset, no operator prompt) for the embeddable widget',
  // AI contact form (/help/kontakt): serves the help center's own anonymous
  // visitors. answer = same grounded KB chatbot as kb/chat (chatEnabled-gated,
  // rate-limited); submit = ticket creation with strict per-IP rate limit,
  // field validation and honeypot; feedback = anonymous deflection counter.
  'app/api/public/contact/answer/route.ts': 'AI contact form — grounded KB answer, chatEnabled-gated, rate-limited',
  'app/api/public/contact/submit/route.ts': 'AI contact form — public ticket intake, rate-limited (5/10 min per IP), validated, honeypot',
  'app/api/public/contact/feedback/route.ts': 'AI contact form — anonymous deflection stat, rate-limited, writes only a KnowledgeEvent',
  // One-click CSAT rating links from outgoing reply emails: authenticated by
  // an HMAC-signed token (verifyCsatToken from lib/csat-token.ts) that is the
  // ONLY way to select a ticket; tenantId is read from the ticket row;
  // rate-limited; writes only a CsatResponse upsert keyed on the ticket.
  'app/api/public/csat/route.ts': 'CSAT rating landing — signed-token authenticated (lib/csat-token.ts), rate-limited, single upsert per ticket',
  // Logged-in customer chatbot: authenticated by a signed identity token
  // (verifyIdentityToken from lib/identity-token.ts), not a session/API key.
  // Rejects with 401 on a missing/invalid/expired token before any data is
  // gathered, and only ever serves data for the email in the SIGNED payload.
  'app/api/me/chat/route.ts': 'Authenticated via signed identity token (lib/identity-token.ts); 401s before any data access, scopes data to the verified email',
};

// Guards from lib/api-auth.ts, plus requireCronSecret (lib/cron-auth.ts) for
// the /api/cron/* routes Vercel Cron invokes with a bearer CRON_SECRET. A
// route calling one of these (and returning the failure response) is
// considered protected.
const LIB_GUARDS = /requireApiAuth|requireSession|requireSuperadmin|requireSettingsAdmin|validateApiKey|requireCronSecret/;

// Routes doing session checks by hand must both call auth() and reject
// (401 for APIs, redirect for browser flows like the Gmail OAuth dance).
const MANUAL_SESSION = /await auth\(\)/;
const MANUAL_REJECT = /status:\s*401|NextResponse\.redirect/;

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findRouteFiles(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

describe('API route auth guards', () => {
  const routeFiles = findRouteFiles(join(ROOT, 'app/api')).map((f) =>
    relative(ROOT, f)
  );

  it('finds the API routes', () => {
    expect(routeFiles.length).toBeGreaterThan(20);
  });

  for (const file of routeFiles) {
    it(`${file} enforces auth`, () => {
      if (file in ALLOWLIST) return;

      const source = readFileSync(join(ROOT, file), 'utf8');
      const usesLibGuard = LIB_GUARDS.test(source);
      const manualSession = MANUAL_SESSION.test(source) && MANUAL_REJECT.test(source);

      expect(
        usesLibGuard || manualSession,
        `${file} has no auth guard. Call requireApiAuth/requireSession/` +
          `requireSuperadmin/validateApiKey from lib/api-auth.ts (or add the ` +
          `route to the allowlist in this test with a justification).`
      ).toBe(true);
    });
  }
});
