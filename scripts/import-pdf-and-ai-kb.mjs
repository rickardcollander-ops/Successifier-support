import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const NEW_DB_URL = "postgresql://neondb_owner:npg_GuEe9BOY3Srv@ep-rapid-bird-akvjmjl9.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require";
const db = new PrismaClient({ datasources: { db: { url: NEW_DB_URL } } });

const PDF_PATH = "C:\\Users\\cozm0\\Downloads\\Support Doldadress.pdf";

// ---- Parse PDF ----
async function parsePDF(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return data.text;
}

// ---- Create KB from PDF ----
async function createKBFromPDF(pdfText, tenantId) {
  // Split by double newlines into sections
  const sections = pdfText.split(/\n{2,}/);
  const articles = [];
  let currentTitle = '';
  let currentContent = '';

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    
    // Heuristic: lines under 100 chars without periods are likely titles
    if (trimmed.length < 100 && !trimmed.includes('.') && trimmed.length > 3) {
      if (currentTitle && currentContent.length > 50) {
        articles.push({ title: currentTitle, content: currentContent.trim() });
      }
      currentTitle = trimmed;
      currentContent = '';
    } else {
      currentContent += trimmed + '\n\n';
    }
  }
  // Save last article
  if (currentTitle && currentContent.length > 50) {
    articles.push({ title: currentTitle, content: currentContent.trim() });
  }

  // If no structured articles found, create chunks
  if (articles.length === 0 && pdfText.length > 100) {
    // Split into ~2000 char chunks
    const chunks = [];
    for (let i = 0; i < pdfText.length; i += 2000) {
      chunks.push(pdfText.substring(i, i + 2000));
    }
    for (let i = 0; i < chunks.length; i++) {
      articles.push({
        title: `Support Doldadress - Del ${i + 1}`,
        content: chunks[i].trim(),
      });
    }
  }

  console.log(`Found ${articles.length} sections from PDF`);

  let created = 0;
  for (const article of articles) {
    try {
      await db.knowledgeBase.create({
        data: {
          tenantId,
          title: article.title.substring(0, 200),
          content: article.content,
          category: 'Import från PDF',
          tags: ['pdf-import', 'support-docs'],
          isActive: true,
        },
      });
      created++;
      console.log(`  ✓ KB: ${article.title.substring(0, 60)}`);
    } catch (e) {
      console.error(`  ✗ KB: ${article.title.substring(0, 60)}: ${e.message}`);
    }
  }
  return created;
}

// ---- AI-generate KB articles from ticket patterns ----
async function generateAIArticles(tenantId) {
  const tickets = await db.ticket.findMany({
    where: { tenantId, status: 'archived' },
    select: { subject: true },
    take: 5000,
  });

  if (tickets.length === 0) {
    console.log('No archived tickets to analyze');
    return 0;
  }

  // Group tickets by normalized subject
  const subjectGroups = {};
  for (const ticket of tickets) {
    const normalized = ticket.subject
      .toLowerCase()
      .replace(/[0-9]+/g, '')
      .replace(/re:|fw:|fwd:|sv:|vs:/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 80);
    
    if (!subjectGroups[normalized]) {
      subjectGroups[normalized] = [];
    }
    subjectGroups[normalized].push(ticket);
  }

  // Find top recurring themes (groups with 5+ tickets)
  const themes = Object.entries(subjectGroups)
    .filter(([_, tickets]) => tickets.length >= 5)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 25);

  console.log(`Found ${themes.length} recurring themes from ${tickets.length} tickets`);
  console.log('Top themes:');
  for (const [theme, tix] of themes.slice(0, 10)) {
    console.log(`  ${tix.length}x: ${theme.substring(0, 60)}`);
  }

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let created = 0;
  for (const [theme, themeTickets] of themes) {
    const sampleSubjects = [...new Set(themeTickets.slice(0, 8).map(t => t.subject))].join('\n- ');
    
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Du är en support-specialist för Doldadress, en svensk adresstjänst. Skapa en intern kunskapsbasartikel på svenska som hjälper supportagenter att snabbt och korrekt hantera ärenden av denna typ. Var konkret och praktisk.`
          },
          {
            role: 'user',
            content: `Det har kommit ${themeTickets.length} ärenden med liknande ämnen:\n- ${sampleSubjects}\n\nSkriv en kunskapsbasartikel med:\n1. **Titel** (kort och tydlig)\n2. **Problem** (vad kunden vanligtvis upplever)\n3. **Lösning** (steg-för-steg hur agenten ska hantera ärendet)\n4. **Mall-svar** (ett färdigt svar agenten kan anpassa)\n\nSvara BARA med artikelinnehållet, inget annat.`
          }
        ],
        temperature: 0.7,
        max_tokens: 1200,
      });

      const aiText = response.choices[0].message.content || '';
      const lines = aiText.split('\n').filter(l => l.trim());
      let title = lines[0]?.replace(/^#+\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '').replace(/^\d+\.\s*/, '').trim() || theme;
      if (title.toLowerCase().startsWith('titel:')) title = title.substring(6).trim();
      const content = aiText;

      await db.knowledgeBase.create({
        data: {
          tenantId,
          title: title.substring(0, 200),
          content,
          category: 'AI-genererad från ärenden',
          tags: ['ai-generated', 'recurring-theme'],
          isActive: true,
        },
      });
      created++;
      console.log(`  ✓ AI KB #${created}: ${title.substring(0, 50)} (${themeTickets.length} ärenden)`);
    } catch (e) {
      console.error(`  ✗ AI KB for "${theme.substring(0, 40)}": ${e.message}`);
    }
  }

  return created;
}

// ---- Main ----
async function main() {
  try {
    const tenant = await db.tenant.findFirst({ where: { subdomain: 'doldadress' } });
    if (!tenant) {
      console.error('Tenant not found!');
      return;
    }
    console.log(`Tenant: ${tenant.id}\n`);

    // Step 1: PDF → Knowledge base
    console.log('=== Creating knowledge base from PDF ===');
    try {
      const pdfText = await parsePDF(PDF_PATH);
      console.log(`PDF text length: ${pdfText.length} characters`);
      const kbFromPDF = await createKBFromPDF(pdfText, tenant.id);
      console.log(`Created ${kbFromPDF} KB articles from PDF\n`);
    } catch (e) {
      console.error(`PDF parsing failed: ${e.message}\n`);
    }

    // Step 2: AI articles from ticket patterns
    console.log('=== Generating AI knowledge base articles ===');
    const aiArticles = await generateAIArticles(tenant.id);
    console.log(`\nCreated ${aiArticles} AI-generated KB articles`);

    // Summary
    const totalKB = await db.knowledgeBase.count({ where: { tenantId: tenant.id } });
    const totalTickets = await db.ticket.count({ where: { tenantId: tenant.id } });
    console.log('\n✅ Complete!');
    console.log(`  Total KB articles: ${totalKB}`);
    console.log(`  Total tickets: ${totalTickets}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.$disconnect();
  }
}

main();
