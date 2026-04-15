const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

const NEW_DB_URL = "postgresql://neondb_owner:npg_GuEe9BOY3Srv@ep-rapid-bird-akvjmjl9.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require";
const db = new PrismaClient({ datasources: { db: { url: NEW_DB_URL } } });
const PDF_PATH = "C:\\Users\\cozm0\\Downloads\\Support Doldadress.pdf";

async function extractPDFText(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  let fullText = '';

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n\n';
  }

  console.log(`Parsed ${doc.numPages} pages`);
  return fullText;
}

async function main() {
  try {
    const tenant = await db.tenant.findFirst({ where: { subdomain: 'doldadress' } });
    if (!tenant) { console.error('Tenant not found!'); return; }
    console.log(`Tenant: ${tenant.id}\n`);

    console.log('=== Parsing PDF ===');
    const pdfText = await extractPDFText(PDF_PATH);
    console.log(`Text length: ${pdfText.length} characters`);
    console.log(`First 500 chars:\n${pdfText.substring(0, 500)}\n`);

    // Split into sections by double newlines
    const sections = pdfText.split(/\n{2,}/);
    const articles = [];
    let currentTitle = '';
    let currentContent = '';

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed || trimmed.length < 5) continue;

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
    if (currentTitle && currentContent.length > 50) {
      articles.push({ title: currentTitle, content: currentContent.trim() });
    }

    // Fallback: chunk the text
    if (articles.length === 0 && pdfText.length > 100) {
      const chunks = [];
      for (let i = 0; i < pdfText.length; i += 3000) {
        chunks.push(pdfText.substring(i, Math.min(i + 3000, pdfText.length)));
      }
      for (let i = 0; i < chunks.length; i++) {
        articles.push({
          title: `Support Doldadress - Del ${i + 1}`,
          content: chunks[i].trim(),
        });
      }
    }

    console.log(`Found ${articles.length} sections\n`);

    let created = 0;
    for (const article of articles) {
      try {
        await db.knowledgeBase.create({
          data: {
            tenantId: tenant.id,
            title: article.title.substring(0, 200),
            content: article.content,
            category: 'Import från PDF',
            tags: ['pdf-import', 'support-docs'],
            isActive: true,
          },
        });
        created++;
        console.log(`  ✓ ${article.title.substring(0, 60)}`);
      } catch (e) {
        console.error(`  ✗ ${article.title.substring(0, 60)}: ${e.message}`);
      }
    }

    console.log(`\n✅ Created ${created} KB articles from PDF`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.$disconnect();
  }
}

main();
