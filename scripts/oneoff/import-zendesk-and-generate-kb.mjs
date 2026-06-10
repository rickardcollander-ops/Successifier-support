import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const NEW_DB_URL = "postgresql://neondb_owner:npg_GuEe9BOY3Srv@ep-rapid-bird-akvjmjl9.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require";
const db = new PrismaClient({ datasources: { db: { url: NEW_DB_URL } } });

const CSV_PATH = "C:\\Users\\cozm0\\Downloads\\tmp_export_csv\\export-2026-02-23-0754-20082570-33527325756050a1bd_1.csv";
const PDF_PATH = "C:\\Users\\cozm0\\Downloads\\Support Doldadress.pdf";

// ---- Step 1: Parse CSV tickets ----
function parseCSV(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  const headers = parseCSVLine(lines[0]);
  
  const tickets = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    tickets.push(row);
  }
  return tickets;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// ---- Step 2: Parse PDF ----
async function parsePDF(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdf(buffer);
  return data.text;
}

// ---- Step 3: Import tickets as archived ----
async function importTickets(tickets, tenantId) {
  let imported = 0;
  let skipped = 0;

  for (const ticket of tickets) {
    const subject = ticket['Subject'] || 'No subject';
    const email = ticket['Requester email'] || '';
    const name = ticket['Requester'] || '';
    const status = ticket['Status'] || 'Closed';
    const createdAt = ticket['Created at'] ? new Date(ticket['Created at']) : new Date();
    const tags = ticket['Tags'] || '';
    const priority = ticket['Priority'] || 'normal';
    
    // Skip tickets without email
    if (!email) {
      skipped++;
      continue;
    }

    try {
      await db.ticket.create({
        data: {
          tenantId,
          customerEmail: email,
          customerName: name || null,
          subject: subject,
          originalMessage: `[Zendesk import]\nÄmne: ${subject}\nTags: ${tags}\nStatus: ${status}\nPrioritet: ${priority}\nSkapad: ${ticket['Created at'] || 'okänt'}\nLöst: ${ticket['Solved at'] || 'ej löst'}`,
          status: 'archived',
          priority: mapPriority(priority),
          contextData: null,
          createdAt: isNaN(createdAt.getTime()) ? new Date() : createdAt,
        },
      });
      imported++;
    } catch (e) {
      skipped++;
    }
  }

  return { imported, skipped };
}

function mapPriority(zendeskPriority) {
  switch (zendeskPriority?.toLowerCase()) {
    case 'urgent': return 'urgent';
    case 'high': return 'high';
    case 'low': return 'low';
    default: return 'normal';
  }
}

// ---- Step 4: Create knowledge base from PDF ----
async function createKBFromPDF(pdfText, tenantId) {
  // Split PDF text into sections
  const sections = pdfText.split(/\n{2,}/);
  const articles = [];
  let currentTitle = '';
  let currentContent = '';

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    
    // Heuristic: short lines are likely titles
    if (trimmed.length < 100 && !trimmed.includes('.') && currentContent) {
      // Save previous article
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

  // If no structured articles found, create one big article
  if (articles.length === 0 && pdfText.length > 100) {
    articles.push({
      title: 'Support Doldadress - Kunskapsbas',
      content: pdfText.trim(),
    });
  }

  let created = 0;
  for (const article of articles) {
    try {
      await db.knowledgeBase.create({
        data: {
          tenantId,
          title: article.title.substring(0, 200),
          content: article.content,
          category: 'Import från PDF',
          tags: ['pdf-import', 'zendesk'],
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

// ---- Step 5: AI-generate KB articles from ticket patterns ----
async function generateAIArticles(tenantId) {
  // Get all archived tickets
  const tickets = await db.ticket.findMany({
    where: { tenantId, status: 'archived' },
    select: { subject: true, originalMessage: true },
    take: 500,
  });

  if (tickets.length === 0) {
    console.log('No archived tickets to analyze');
    return 0;
  }

  // Group tickets by subject patterns
  const subjectGroups = {};
  for (const ticket of tickets) {
    const normalized = ticket.subject
      .toLowerCase()
      .replace(/[0-9]+/g, '')
      .replace(/re:|fw:|fwd:/gi, '')
      .trim();
    
    if (!subjectGroups[normalized]) {
      subjectGroups[normalized] = [];
    }
    subjectGroups[normalized].push(ticket);
  }

  // Find top recurring themes (groups with 3+ tickets)
  const themes = Object.entries(subjectGroups)
    .filter(([_, tickets]) => tickets.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20);

  console.log(`\nFound ${themes.length} recurring themes from ${tickets.length} tickets`);

  // Use OpenAI to generate KB articles
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let created = 0;
  for (const [theme, themeTickets] of themes) {
    const sampleSubjects = themeTickets.slice(0, 5).map(t => t.subject).join('\n');
    
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Du är en support-specialist för Doldadress (adresstjänst). Skapa en kunskapsbasartikel på svenska baserat på återkommande supportärenden. Artikeln ska hjälpa supportagenter att snabbt svara på liknande frågor. Formatera med tydlig titel, problemsammanfattning, och rekommenderad lösning.'
          },
          {
            role: 'user',
            content: `Skapa en kunskapsbasartikel baserat på dessa ${themeTickets.length} återkommande ärenden:\n\nÄmnen:\n${sampleSubjects}\n\nSkriv en artikel med:\n1. Titel\n2. Sammanfattning av problemet\n3. Rekommenderad lösning/svar\n4. Relevanta tags (kommaseparerade)`
          }
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const aiText = response.choices[0].message.content || '';
      
      // Parse title from first line
      const lines = aiText.split('\n').filter(l => l.trim());
      let title = lines[0]?.replace(/^#+ /, '').replace(/^\*\*/, '').replace(/\*\*$/, '').trim() || theme;
      const content = lines.slice(1).join('\n').trim();
      
      // Parse tags from AI response
      const tagMatch = aiText.match(/tags?[:\s]+(.+)/i);
      const tags = tagMatch 
        ? tagMatch[1].split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0)
        : ['ai-generated'];

      await db.knowledgeBase.create({
        data: {
          tenantId,
          title: title.substring(0, 200),
          content: content || aiText,
          category: 'AI-genererad från ärenden',
          tags: ['ai-generated', ...tags.slice(0, 5)],
          isActive: true,
        },
      });
      created++;
      console.log(`  ✓ AI KB: ${title.substring(0, 60)} (${themeTickets.length} ärenden)`);
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

    // Step 1: Parse and import CSV tickets
    console.log('=== Importing Zendesk tickets from CSV ===');
    const csvTickets = parseCSV(CSV_PATH);
    console.log(`Parsed ${csvTickets.length} tickets from CSV`);
    const { imported, skipped } = await importTickets(csvTickets, tenant.id);
    console.log(`Imported: ${imported}, Skipped: ${skipped}\n`);

    // Step 2: Parse PDF and create knowledge base
    console.log('=== Creating knowledge base from PDF ===');
    const pdfText = await parsePDF(PDF_PATH);
    console.log(`PDF text length: ${pdfText.length} characters`);
    const kbFromPDF = await createKBFromPDF(pdfText, tenant.id);
    console.log(`Created ${kbFromPDF} KB articles from PDF\n`);

    // Step 3: AI-generate KB articles from ticket patterns
    console.log('=== Generating AI knowledge base articles ===');
    const aiArticles = await generateAIArticles(tenant.id);
    console.log(`\nCreated ${aiArticles} AI-generated KB articles`);

    console.log('\n✅ Import complete!');
    console.log(`  Archived tickets: ${imported}`);
    console.log(`  KB from PDF: ${kbFromPDF}`);
    console.log(`  KB from AI: ${aiArticles}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.$disconnect();
  }
}

main();
