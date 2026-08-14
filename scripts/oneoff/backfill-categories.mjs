// Backfill AI categories for existing tickets, so the "vad kunderna frågar
// om" report panel has history from day one instead of only filling forward.
// Uses the same helper model and forced-tool-call as
// lib/services/ticket-classifier.ts (replicated because .mjs scripts can't
// import the TS lib).
//
// Resumable & idempotent: only tickets with category IS NULL are touched, so
// an interrupted run just continues where it stopped. Zendesk-import tickets
// are excluded, matching the reports population. Batched with a small delay
// between batches to stay polite to the API.
//
// Usage:
//   DRY_RUN=1 node scripts/oneoff/backfill-categories.mjs   # count only
//   node scripts/oneoff/backfill-categories.mjs
//   TENANT=serus LIMIT=200 node scripts/oneoff/backfill-categories.mjs

import { PrismaClient } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';

const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DRY_RUN = process.env.DRY_RUN === '1';
const TENANT = process.env.TENANT || 'doldadress';
// Optional cap for a trial run; 0 = no cap.
const LIMIT = Number(process.env.LIMIT || 0);

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;
const HELPER_MODEL = 'claude-haiku-4-5';
const ZENDESK_IMPORT_MARKER = '[Zendesk Import Source:';

// Keep in sync with lib/products/<tenant>.ts ticketCategories.
const CATEGORIES = {
  doldadress: [
    'uppsägning',
    'faktura & betalning',
    'abonnemang',
    'adressändring',
    'inloggning & konto',
    'leverans & post',
    'reklamation',
    'övrigt',
  ],
  serus: [
    'cancellation',
    'billing & payment',
    'subscription',
    'login & account',
    'technical issue',
    'complaint',
    'other',
  ],
}[TENANT];

if (!CATEGORIES) {
  console.error(`Unknown tenant "${TENANT}" — add its category list to this script.`);
  process.exit(1);
}

async function classify(subject, message) {
  try {
    const result = await anthropic.messages.create({
      model: HELPER_MODEL,
      max_tokens: 100,
      tools: [
        {
          name: 'classify_ticket',
          description: 'Klassificera kundärendet i exakt en kategori.',
          input_schema: {
            type: 'object',
            properties: {
              category: { type: 'string', enum: CATEGORIES },
            },
            required: ['category'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'classify_ticket' },
      messages: [
        {
          role: 'user',
          content: `Klassificera detta kundtjänstärende.\n\nÄmne: ${subject}\n\nMeddelande:\n${message.slice(0, 2000)}`,
        },
      ],
    });
    const toolUse = result.content.find((b) => b.type === 'tool_use');
    const category = toolUse?.input?.category;
    return typeof category === 'string' && CATEGORIES.includes(category) ? category : null;
  } catch (error) {
    console.error('  classification failed:', error?.message || error);
    return null;
  }
}

// The customer's original question: first thread segment, minus sync
// metadata headers (same reduction as the reports drill-down).
function questionText(originalMessage) {
  return originalMessage
    .replace(/\[Gmail ID:.*?\]\n?(\[Message-Id:.*?\]\n?)?(\[Inbox account:.*?\]\n?)?\n?/g, '')
    .split(/\n---\n/)[0]
    .trim();
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: TENANT } });
  if (!tenant) {
    console.error(`Tenant "${TENANT}" not found`);
    process.exit(1);
  }

  const total = await prisma.ticket.count({
    where: {
      tenantId: tenant.id,
      category: null,
      NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
    },
  });
  console.log(`${total} uncategorised tickets for ${TENANT}${DRY_RUN ? ' (dry run — stopping here)' : ''}`);
  if (DRY_RUN || total === 0) return;

  let processed = 0;
  let categorised = 0;
  for (;;) {
    const batch = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        category: null,
        NOT: { originalMessage: { contains: ZENDESK_IMPORT_MARKER } },
      },
      select: { id: true, subject: true, originalMessage: true },
      orderBy: { createdAt: 'desc' },
      take: BATCH_SIZE,
      // No cursor needed: categorised tickets drop out of the filter, and
      // failures return null (left as-is) — skip those below to avoid loops.
      skip: processed - categorised,
    });
    if (batch.length === 0) break;

    for (const ticket of batch) {
      const category = await classify(ticket.subject, questionText(ticket.originalMessage));
      processed += 1;
      if (category) {
        categorised += 1;
        // Raw SQL so updatedAt stays untouched (same as the live hook).
        await prisma.$executeRaw`
          UPDATE "Ticket" SET "category" = ${category} WHERE id = ${ticket.id}
        `;
      }
      if (processed % 10 === 0 || processed === total) {
        console.log(`  ${processed}/${total} processed, ${categorised} categorised`);
      }
      if (LIMIT > 0 && processed >= LIMIT) {
        console.log(`LIMIT=${LIMIT} reached — stopping (re-run to continue).`);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }
  console.log(`Done: ${categorised}/${processed} tickets categorised.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
