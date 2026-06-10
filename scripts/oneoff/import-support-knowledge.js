const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SOURCE_FILE = process.argv[2] || 'C:\\Users\\cozm0\\Downloads\\Support Doldadress.extracted.txt';
const TARGET_TENANT = 'doldadress';

const SECTION_DEFS = [
  { heading: 'Kund synlig fortf', title: 'Supportmall: Kund synlig fortfarande', category: 'supportmall', tags: ['synlighet', 'upplysningar', 'avindexering'] },
  { heading: 'Upplysningar', title: 'Supportmall: Upplysningar', category: 'supportmall', tags: ['upplysningar', 'mrkoll', 'upplysning.se'] },
  { heading: 'Ångerrätt', title: 'Supportmall: Ångerrätt och retur', category: 'supportmall', tags: ['ångerrätt', 'retur', 'reklamation'] },
  { heading: 'Vill bli kund', title: 'Supportmall: Vill bli kund', category: 'supportmall', tags: ['försäljning', 'onboarding', 'tjänstebeskrivning'] },
  { heading: 'Uppsägning', title: 'Supportmall: Uppsägning', category: 'supportmall', tags: ['uppsägning', 'bindningstid', 'fakturor'] },
  { heading: 'Tekniskt fel', title: 'Supportmall: Tekniskt fel', category: 'supportmall', tags: ['tekniskt fel', 'registrering', 'personnummer'] },
  { heading: 'Avindexering', title: 'Supportmall: Avindexering', category: 'supportmall', tags: ['avindexering', 'google', 'fullmakt'] },
  { heading: 'ID SKYDD', title: 'Supportmall: ID-skydd', category: 'supportmall', tags: ['id-skydd', 'faktura', 'rabatt'] },
  { heading: 'Reklamation', title: 'Supportmall: Reklamation', category: 'supportmall', tags: ['reklamation', 'återbetalning', 'missnöjd kund'] },
  { heading: 'Mina sidor', title: 'Supportmall: Mina sidor', category: 'supportmall', tags: ['mina sidor', 'adress', 'fullmakt', 'dataläcka'] },
  { heading: 'Övrigt', title: 'Supportmall: Övrigt', category: 'supportmall', tags: ['övrigt', 'biluppgifter', 'bolagsinformation'] },
  { heading: 'Fakturafråga', title: 'Supportmall: Fakturafrågor', category: 'supportmall', tags: ['fakturor', 'betalning', 'autogiro'] },
  { heading: 'Inloggning kunder', title: 'Supportmall: Inloggning kunder', category: 'supportmall', tags: ['inloggning', 'registreringslänk', 'konto'] },
  { heading: 'Rabatt', title: 'Supportmall: Rabatt', category: 'supportmall', tags: ['rabatt', 'almi', 'återbetalning'] },
  { heading: 'Onboardning', title: 'Supportmall: Onboarding', category: 'supportmall', tags: ['onboarding', 'kom igång', 'registrering'] },
  { heading: 'IMY avindexering', title: 'Supportmall: IMY avindexering', category: 'supportmall', tags: ['imy', 'avindexering', 'klagomål'] },
];

function normalizeExtractedText(rawText) {
  const lines = rawText
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim());

  const paragraphs = [];
  let current = [];

  for (const line of lines) {
    if (!line) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }

  return paragraphs
    .join('\n\n')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractSections(normalizedText) {
  const indexed = [];
  const lowered = normalizedText.toLowerCase();

  for (const def of SECTION_DEFS) {
    const idx = lowered.indexOf(def.heading.toLowerCase());
    if (idx !== -1) {
      indexed.push({ ...def, idx });
    }
  }

  indexed.sort((a, b) => a.idx - b.idx);

  const sections = [];
  for (let i = 0; i < indexed.length; i++) {
    const current = indexed[i];
    const next = indexed[i + 1];
    const start = current.idx + current.heading.length;
    const end = next ? next.idx : normalizedText.length;

    let content = normalizedText.slice(start, end).trim();
    content = content.replace(/TO DO:[\s\S]*$/i, '').trim();

    if (!content) continue;

    sections.push({
      ...current,
      content: `Källa: Support Doldadress.pdf\nSektion: ${current.heading}\n\n${content}`,
    });
  }

  return sections;
}

async function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`Källfil hittades inte: ${SOURCE_FILE}`);
  }

  const raw = fs.readFileSync(SOURCE_FILE, 'utf8');
  const normalized = normalizeExtractedText(raw);
  const sections = extractSections(normalized);

  if (sections.length === 0) {
    throw new Error('Inga sektioner kunde extraheras från dokumentet.');
  }

  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [{ id: TARGET_TENANT }, { subdomain: TARGET_TENANT }],
    },
    select: { id: true, subdomain: true },
  });

  if (!tenant) {
    throw new Error(`Kunde inte hitta tenant '${TARGET_TENANT}' i databasen.`);
  }

  let created = 0;
  let updated = 0;

  for (const section of sections) {
    const existing = await prisma.knowledgeBase.findFirst({
      where: {
        tenantId: tenant.id,
        title: section.title,
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.knowledgeBase.update({
        where: { id: existing.id },
        data: {
          content: section.content,
          category: section.category,
          tags: section.tags,
          isActive: true,
        },
      });
      updated += 1;
    } else {
      await prisma.knowledgeBase.create({
        data: {
          tenantId: tenant.id,
          title: section.title,
          content: section.content,
          category: section.category,
          tags: section.tags,
          isActive: true,
        },
      });
      created += 1;
    }
  }

  console.log(`Klar. Sektioner: ${sections.length}, skapade: ${created}, uppdaterade: ${updated}, tenant: ${tenant.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
