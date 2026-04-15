const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai').default;

const DB_URL = "postgresql://neondb_owner:npg_GuEe9BOY3Srv@ep-rapid-bird-akvjmjl9.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require";
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  // Get all PDF KB articles
  const pdfArticles = await db.knowledgeBase.findMany({
    where: { category: 'Import från PDF' }
  });
  
  console.log(`Found ${pdfArticles.length} PDF articles to restructure\n`);
  
  for (const article of pdfArticles) {
    console.log(`Processing: ${article.title}`);
    
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Du är en expert på att strukturera kundsupportdokumentation för AI-assistenter. Din uppgift är att omstrukturera råtext från en PDF till ett välorganiserat format som är lätt för en AI att förstå och använda när den svarar på kundfrågor.

Strukturera innehållet enligt följande format:

# [Tydlig Titel]

## Sammanfattning
[Kort sammanfattning av vad detta handlar om - 1-2 meningar]

## Problem/Situation
[Beskriv vilket kundproblem eller situation detta adresserar]

## Lösning/Svar
[Steg-för-steg lösning eller tydligt svar]

## Viktiga Punkter
- [Bullet points med nyckelinformation]
- [Specifika detaljer, länkar, kontaktuppgifter etc]

## Relaterade Ämnen
[Taggar eller relaterade ämnen som kan hjälpa AI att hitta detta]

Behåll all faktisk information från originaltexten men organisera den logiskt. Om texten innehåller länkar, system-URLs eller specifika instruktioner - behåll dessa exakt.`
          },
          {
            role: 'user',
            content: `Omstrukturera följande kundsupportartikel:\n\nTitel: ${article.title}\n\nInnehåll:\n${article.content}`
          }
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const restructuredContent = response.choices[0].message.content;
      
      // Extract new title from restructured content (first # heading)
      const titleMatch = restructuredContent.match(/^#\s+(.+)$/m);
      const newTitle = titleMatch ? titleMatch[1].trim() : article.title;
      
      // Update the article
      await db.knowledgeBase.update({
        where: { id: article.id },
        data: {
          title: newTitle.substring(0, 200),
          content: restructuredContent,
          tags: [...new Set([...article.tags, 'restructured', 'ai-optimized'])],
        },
      });
      
      console.log(`  ✓ Updated: ${newTitle.substring(0, 60)}\n`);
    } catch (error) {
      console.error(`  ✗ Error: ${error.message}\n`);
    }
  }
  
  console.log('✅ Restructuring complete!');
  await db.$disconnect();
}

main();
