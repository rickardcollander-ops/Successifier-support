/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2];

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

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

function chunkByApproxLength(items, maxChars) {
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const item of items) {
    const len = item.length;
    if (current.length > 0 && currentLen + len > maxChars) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(item);
    currentLen += len;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function cleanMessage(text) {
  return String(text || '')
    .replace(/\[Zendesk Import Source:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function summarizeChunk(openai, chunkLines, chunkIndex, totalChunks) {
  const prompt = `Du analyserar importerade supportärenden för att skapa kunskapsartiklar.

Summera detta chunk #${chunkIndex + 1}/${totalChunks} med:
1) Vanligaste problemtyper (max 8)
2) Vanligaste frågor kunden ställer
3) Nyckelpolicy/regel som ofta behövs i svar
4) Förslag på kunskapsartiklar (title + varför)

Svara ENDAST i JSON enligt schema:
{
  "themes": [{"name":"...","countApprox":0,"why":"..."}],
  "customerQuestions": ["..."],
  "policyGaps": ["..."],
  "articleIdeas": [{"title":"...","why":"...","targetAudience":"agent|customer"}]
}

Ärenden:
${chunkLines.join('\n\n')}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Du är en senior knowledge manager för kundsupport.' },
      { role: 'user', content: prompt },
    ],
  });

  const content = completion.choices[0]?.message?.content || '{}';
  return JSON.parse(content);
}

async function buildFinalSuggestions(openai, chunkSummaries, maxArticles) {
  const prompt = `Nedan finns delsummeringar från importerade supportärenden.
Skapa en prioriterad lista på högst ${maxArticles} kunskapsartiklar för "Knowledge".

Krav per artikel:
- title (kort och tydlig)
- category (t.ex. billing, account, onboarding, cancellation, technical)
- tags (3-6 st)
- problemSummary (1-2 meningar)
- recommendedContentOutline (3-6 bullets)
- exampleMacroReply (kort svensk svarsmall)
- priority (high|medium|low)
- sourceSignals (vilka teman/frågor som stödjer artikeln)

Svara ENDAST i JSON:
{
  "articles": [
    {
      "title": "...",
      "category": "...",
      "tags": ["..."],
      "problemSummary": "...",
      "recommendedContentOutline": ["..."],
      "exampleMacroReply": "...",
      "priority": "high",
      "sourceSignals": ["..."]
    }
  ]
}

Delsummeringar:
${JSON.stringify(chunkSummaries, null, 2)}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Du producerar strukturerade, praktiskt användbara kunskapsartiklar för supportteam.' },
      { role: 'user', content: prompt },
    ],
  });

  return JSON.parse(completion.choices[0]?.message?.content || '{"articles": []}');
}

async function main() {
  loadEnvLocal();

  const args = parseArgs(process.argv);
  const tenantSubdomain = args.tenant || 'doldadress';
  const maxTickets = Number(args.maxTickets || 600);
  const maxArticles = Number(args.maxArticles || 10);
  const outputPath = args.output || path.join(process.cwd(), 'knowledge-suggestions-from-import.json');

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY saknas i miljön (.env.local).');
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const tenant = await prisma.tenant.findUnique({
    where: { subdomain: tenantSubdomain },
    select: { id: true, subdomain: true },
  });

  if (!tenant) {
    throw new Error(`Tenant hittades inte: ${tenantSubdomain}`);
  }

  const since = new Date();
  since.setDate(since.getDate() - 2);

  const tickets = await prisma.ticket.findMany({
    where: {
      tenantId: tenant.id,
      originalMessage: { contains: '[Zendesk Import Source:' },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: maxTickets,
    select: {
      id: true,
      createdAt: true,
      customerEmail: true,
      subject: true,
      status: true,
      priority: true,
      originalMessage: true,
    },
  });

  if (tickets.length === 0) {
    throw new Error('Hittade inga importerade ärenden de senaste 2 dagarna.');
  }

  const lines = tickets.map((t, idx) => {
    const message = cleanMessage(t.originalMessage).slice(0, 1200);
    return [
      `[#${idx + 1}] TicketId: ${t.id}`,
      `Date: ${t.createdAt.toISOString()}`,
      `Email: ${t.customerEmail}`,
      `Priority/Status: ${t.priority}/${t.status}`,
      `Subject: ${t.subject}`,
      `Body: ${message}`,
    ].join('\n');
  });

  const chunks = chunkByApproxLength(lines, 28000);
  const chunkSummaries = [];

  for (let i = 0; i < chunks.length; i += 1) {
    console.log(`Analyserar chunk ${i + 1}/${chunks.length}...`);
    const summary = await summarizeChunk(openai, chunks[i], i, chunks.length);
    chunkSummaries.push(summary);
  }

  console.log('Genererar slutliga förslag på knowledge-artiklar...');
  const finalResult = await buildFinalSuggestions(openai, chunkSummaries, maxArticles);

  const payload = {
    generatedAt: new Date().toISOString(),
    tenant: tenant.subdomain,
    importedTicketCount: tickets.length,
    chunks: chunks.length,
    articles: finalResult.articles || [],
  };

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Klar. ${payload.articles.length} förslag sparade i:`);
  console.log(outputPath);
}

main()
  .catch((error) => {
    console.error('Misslyckades:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
