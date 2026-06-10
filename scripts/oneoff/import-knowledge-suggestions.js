/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key.slice(2)] = next;
      i += 1;
    } else {
      args[key.slice(2)] = 'true';
    }
  }
  return args;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatContent(article) {
  const outline = asArray(article.recommendedContentOutline)
    .map((item) => `- ${item}`)
    .join('\n');

  const signals = asArray(article.sourceSignals)
    .map((item) => `- ${item}`)
    .join('\n');

  return [
    `Källa: AI-förslag från importerade Zendesk-ärenden`,
    `Prioritet: ${article.priority || 'medium'}`,
    '',
    `Problemsammanfattning:`,
    article.problemSummary || '-',
    '',
    `Rekommenderat innehåll:`,
    outline || '-',
    '',
    `Exempel på svarsmall:`,
    article.exampleMacroReply || '-',
    '',
    `Signaler från ärenden:`,
    signals || '-',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const tenantSubdomain = args.tenant || 'doldadress';
  const sourcePath = args.source || path.join(process.cwd(), 'scripts', 'oneoff', 'knowledge-suggestions-from-imported-tickets.json');
  const titlePrefix = args.prefix || 'AI Draft:';

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Källfil hittades inte: ${sourcePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const articles = asArray(raw.articles);

  if (articles.length === 0) {
    throw new Error('Inga artikelförslag hittades i källfilen.');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { subdomain: tenantSubdomain },
    select: { id: true, subdomain: true },
  });

  if (!tenant) {
    throw new Error(`Tenant hittades inte: ${tenantSubdomain}`);
  }

  let created = 0;
  let updated = 0;

  for (const article of articles) {
    const title = `${titlePrefix} ${String(article.title || 'Untitled').trim()}`.trim();
    const content = formatContent(article);
    const tags = asArray(article.tags)
      .map((tag) => String(tag || '').trim())
      .filter(Boolean)
      .slice(0, 8);

    const existing = await prisma.knowledgeBase.findFirst({
      where: {
        tenantId: tenant.id,
        title,
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.knowledgeBase.update({
        where: { id: existing.id },
        data: {
          content,
          category: article.category || 'general',
          tags,
          isActive: false,
        },
      });
      updated += 1;
    } else {
      await prisma.knowledgeBase.create({
        data: {
          tenantId: tenant.id,
          title,
          content,
          category: article.category || 'general',
          tags,
          isActive: false,
        },
      });
      created += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        tenant: tenant.subdomain,
        sourcePath,
        totalInputArticles: articles.length,
        created,
        updated,
        isActive: false,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
