import OpenAI from 'openai';
import { prisma } from '@/lib/db/client';
import type { KnowledgeBase } from '@/lib/types';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAIN_MODEL = 'gpt-4o';
const HELPER_MODEL = 'gpt-4o-mini';

// --- Keyword Groups (synonym expansion, Stage 1 only) ---

const KEYWORD_GROUPS: Record<string, string[]> = {
  uppsägning: ['säga upp', 'säger upp', 'avsluta', 'avslutar', 'stänga', 'cancel', 'cancellation', 'terminate', 'sluta', 'inte vill ha', 'vill inte ha', 'avslut', 'uppsäg'],
  faktura: ['invoice', 'räkning', 'betalning', 'betala', 'obetald', 'förfallen', 'förfaller', 'bill', 'belopp', 'fakturor', 'kreditfaktura', 'avgift'],
  abonnemang: ['prenumeration', 'subscription', 'plan', 'förnyelse', 'förnya', 'period', 'månadskostnad'],
  leverans: ['leverera', 'delivery', 'frakt', 'skicka', 'skickad', 'posta', 'brev', 'kivra', 'e-faktura', 'efaktura'],
  inloggning: ['logga in', 'login', 'lösenord', 'password', 'konto', 'mina sidor', 'account', 'glömt lösenord', 'komma in', 'nå min', 'nå mitt'],
  adress: ['address', 'adressändring', 'flytta', 'flytt', 'ny adress', 'ändra adress', 'byta adress'],
  betalning: ['swish', 'kort', 'card', 'autogiro', 'bankgiro', 'betalt', 'betalat', 'payment'],
  reklamation: ['klaga', 'complaint', 'missnöjd', 'fel', 'problem', 'fungerar inte', 'trasig', 'skadat'],
};

function expandKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const expanded: string[] = [];
  for (const synonyms of Object.values(KEYWORD_GROUPS)) {
    if (synonyms.some(syn => lower.includes(syn))) {
      expanded.push(...synonyms);
    }
  }
  return expanded;
}

function keywordScore(
  titleLower: string,
  contentLower: string,
  category: string | null,
  tags: string[],
  words: string[],
  messageLower: string,
  expandedTerms: string[]
): number {
  let score = 0;
  if (messageLower.includes(titleLower) || titleLower.includes(messageLower.substring(0, 60))) score += 15;
  score += words.filter(w => titleLower.includes(w)).length * 3;
  score += Math.min(words.filter(w => contentLower.includes(w)).length * 1.5, 10);
  score += tags.filter(tag =>
    messageLower.includes(tag.toLowerCase()) || words.some(w => tag.toLowerCase().includes(w))
  ).length * 4;
  if (expandedTerms.length > 0) {
    score += expandedTerms.filter(t => titleLower.includes(t)).length * 5;
    score += Math.min(expandedTerms.filter(t => contentLower.includes(t)).length * 2, 8);
  }
  if (category) {
    const catLower = category.toLowerCase();
    if (words.some(w => catLower.includes(w))) score += 3;
    if (expandedTerms.some(t => catLower.includes(t))) score += 3;
  }
  return score;
}

// --- Stage 1+2: Hybrid KB Retrieval ---

async function findRelevantKnowledge(
  tenantId: string,
  subject: string,
  message: string
): Promise<{ formatted: string; citedIds: string[] }> {
  try {
    const knowledgeBase = await prisma.knowledgeBase.findMany({
      where: { tenantId, isActive: true },
    });
    if (knowledgeBase.length === 0) return { formatted: '', citedIds: [] };

    const fullQuery = `${subject} ${message}`;
    const messageLower = fullQuery.toLowerCase();
    const words = messageLower.split(/\s+/).filter(w => w.length > 2);
    const expandedTerms = expandKeywords(messageLower);

    // Stage 1: keyword scoring — take broad top-12 (or all if KB is small)
    const scored: { kb: KnowledgeBase; score: number }[] = knowledgeBase
      .map((kb: KnowledgeBase) => {
        let score = keywordScore(
          kb.title.toLowerCase(),
          kb.content.toLowerCase(),
          kb.category,
          kb.tags,
          words,
          messageLower,
          expandedTerms
        );
        if (kb.category === 'Lärande från skickade svar') score *= 0.7;
        return { kb, score };
      })
      .sort((a: { kb: KnowledgeBase; score: number }, b: { kb: KnowledgeBase; score: number }) => b.score - a.score);

    const candidates: { kb: KnowledgeBase; score: number }[] = knowledgeBase.length <= 8
      ? scored.filter(({ score }: { kb: KnowledgeBase; score: number }) => score > 2)
      : scored.filter(({ score }: { kb: KnowledgeBase; score: number }) => score > 2).slice(0, 12);

    if (candidates.length === 0) return { formatted: '', citedIds: [] };

    let selected: KnowledgeBase[];

    // Stage 2: LLM rerank when we have multiple candidates
    if (candidates.length > 3) {
      try {
        const candidateList = candidates.map((c: { kb: KnowledgeBase; score: number }, i: number) =>
          `${i + 1}. [ID:${c.kb.id}] ${c.kb.title}${c.kb.category ? ` [${c.kb.category}]` : ''}\n${c.kb.content.substring(0, 400)}`
        ).join('\n\n');

        const rerank = await openai.chat.completions.create({
          model: HELPER_MODEL,
          messages: [
            {
              role: 'system',
              content: 'Du är en sökmotor för kunskapsbas-artiklar. Välj de artiklar (max 5) som är mest relevanta för kundens fråga. Returnera ENBART JSON: {"selected": [1, 3, 5]} med 1-baserade artikelnummer. Om ingen artikel är relevant, returnera {"selected": []}.',
            },
            {
              role: 'user',
              content: `KUNDENS FRÅGA:\nÄmne: ${subject}\n${message.substring(0, 800)}\n\nTILLGÄNGLIGA ARTIKLAR:\n${candidateList}`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 100,
        });

        const parsed = JSON.parse(rerank.choices[0].message.content || '{}');
        if (Array.isArray(parsed.selected) && parsed.selected.length > 0) {
          selected = parsed.selected
            .filter((i: unknown) => typeof i === 'number' && i >= 1 && i <= candidates.length)
            .map((i: number) => candidates[i - 1].kb);
        } else {
          selected = [];
        }
      } catch (err) {
        console.error('[AI] KB rerank failed, falling back to keyword scoring:', err);
        selected = candidates.filter(c => c.score > 2).slice(0, 5).map(c => c.kb);
      }
    } else {
      selected = candidates.filter(c => c.score > 2).map(c => c.kb);
    }

    if (selected.length === 0) return { formatted: '', citedIds: [] };

    let formatted = '\n\n=== KUNSKAPSBAS (VIKTIG: Basera alltid svaret på dessa artiklar. Hitta inte på info som inte finns här) ===\n';
    selected.forEach(kb => {
      formatted += `\n--- [${kb.id}] ${kb.title}${kb.category ? ` [${kb.category}]` : ''} ---\n${kb.content}\n`;
    });

    return { formatted, citedIds: selected.map(kb => kb.id) };
  } catch (error) {
    console.error('[AI] Error fetching knowledge base:', error);
    return { formatted: '', citedIds: [] };
  }
}

// --- Local query result types ---

interface FeedbackRow {
  subject: string;
  originalMessage: string;
  finalResponse: string | null;
  wasEdited: boolean;
  rating: string | null;
}

interface NegativeFeedbackRow {
  subject: string;
  originalMessage: string;
  aiResponse: string;
  finalResponse: string | null;
}

interface PreviousTicketRow {
  subject: string;
  originalMessage: string;
  finalResponse: string | null;
  status: string;
  createdAt: Date;
}

// --- Learning Examples (positive + sent, with edit signal) ---

async function findLearningExamples(tenantId: string, subject: string, message: string): Promise<string> {
  try {
    const fullText = `${subject} ${message}`;
    const searchTerms = fullText.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 6);

    if (searchTerms.length === 0) return '';

    // Only use explicitly positive-rated feedback as learning examples.
    // Legacy / unrated rows are excluded — they may contain stale data that
    // should not influence current responses.
    const feedback = await prisma.aIResponseFeedback.findMany({
      where: {
        tenantId,
        rating: 'positive',
        finalResponse: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        subject: true,
        originalMessage: true,
        finalResponse: true,
        wasEdited: true,
        rating: true,
      },
    });

    if (feedback.length === 0) return '';

    // Score by text overlap
    const scored: { fb: FeedbackRow; score: number }[] = (feedback as FeedbackRow[])
      .map((fb: FeedbackRow) => {
        const fbText = `${fb.subject} ${fb.originalMessage}`.toLowerCase();
        const matchCount = searchTerms.filter(t => fbText.includes(t)).length;
        // Prefer non-edited (AI was already good) and explicitly positive rated
        const editBonus = fb.wasEdited ? 0 : 0.5;
        const ratingBonus = fb.rating === 'positive' ? 1 : 0;
        return { fb, score: matchCount + editBonus + ratingBonus };
      })
      .filter(({ score }: { fb: FeedbackRow; score: number }) => score > 0)
      .sort((a: { fb: FeedbackRow; score: number }, b: { fb: FeedbackRow; score: number }) => b.score - a.score)
      .slice(0, 3);

    if (scored.length === 0) return '';

    let formatted = '\n\n=== GODKÄNDA EXEMPELSVAR (Använd som riktlinje för ton, format och längd) ===\n';
    scored.forEach(({ fb }: { fb: FeedbackRow; score: number }, index: number) => {
      formatted += `\nExempel ${index + 1}${fb.wasEdited ? ' (redigerat av agent)' : ' (AI-svar, godkänt direkt)'}:\n`;
      formatted += `Ämne: ${fb.subject}\n`;
      formatted += `Kund: ${fb.originalMessage.replace(/\[Gmail ID:.*?\]\n?\[Inbox account:.*?\]\n?\n?/g, '').substring(0, 300).trim()}\n`;
      formatted += `Godkänt svar: ${fb.finalResponse?.substring(0, 500) || 'N/A'}\n`;
    });

    // Anti-examples: recently edited responses where AI clearly got it wrong
    const negatives = await prisma.aIResponseFeedback.findMany({
      where: {
        tenantId,
        rating: 'negative',
        wasEdited: true,
        finalResponse: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        subject: true,
        originalMessage: true,
        aiResponse: true,
        finalResponse: true,
      },
    });

    const relevantNegatives: { fb: NegativeFeedbackRow; score: number }[] = (negatives as NegativeFeedbackRow[])
      .map((fb: NegativeFeedbackRow) => {
        const fbText = `${fb.subject} ${fb.originalMessage}`.toLowerCase();
        const matchCount = searchTerms.filter(t => fbText.includes(t)).length;
        return { fb, score: matchCount };
      })
      .filter(({ score }: { fb: NegativeFeedbackRow; score: number }) => score > 0)
      .sort((a: { fb: NegativeFeedbackRow; score: number }, b: { fb: NegativeFeedbackRow; score: number }) => b.score - a.score)
      .slice(0, 2);

    if (relevantNegatives.length > 0) {
      formatted += '\n=== UNDVIK (AI-svar som inte godkändes och korrigerades) ===\n';
      relevantNegatives.forEach(({ fb }: { fb: NegativeFeedbackRow; score: number }, index: number) => {
        formatted += `\nUndvik-exempel ${index + 1} (ämne: ${fb.subject}):\n`;
        formatted += `AI svarade: ${fb.aiResponse.substring(0, 300).trim()}\n`;
        formatted += `Korrekta svaret: ${fb.finalResponse?.substring(0, 300).trim()}\n`;
      });
    }

    return formatted;
  } catch (error) {
    console.error('[AI] Error fetching learning examples:', error);
    return '';
  }
}

// --- Context Formatting ---

function formatContextForPrompt(contextData: any): string {
  if (!contextData) return '';

  let formatted = '\n\n=== KUNDINFORMATION FRÅN SYSTEM ===\n';
  let hasData = false;

  if (contextData.stripe) {
    hasData = true;
    formatted += '\n--- Prenumerationer & Betalningar ---\n';
    if (contextData.stripe.accountClosed) {
      formatted += '⚠️ KONTO AVSLUTAT - Alla prenumerationer är avslutade\n';
    }
    const subs = contextData.stripe.subscriptions || [];
    if (subs.length > 0) {
      formatted += `Prenumerationer (${subs.length}):\n`;
      subs.forEach((sub: any) => {
        formatted += `  - ${sub.id}: status=${sub.status}`;
        if (sub.currentPeriodEnd) formatted += `, period slutar ${new Date(sub.currentPeriodEnd * 1000).toLocaleDateString('sv-SE')}`;
        if (sub.canceledAt) formatted += `, avslutad ${new Date(sub.canceledAt * 1000).toLocaleDateString('sv-SE')}`;
        if (sub.endedAt) formatted += `, upphörd ${new Date(sub.endedAt * 1000).toLocaleDateString('sv-SE')}`;
        if (sub.cancelAt && !sub.canceledAt) formatted += `, avslutas ${new Date(sub.cancelAt * 1000).toLocaleDateString('sv-SE')}`;
        if (sub.items?.[0]?.price) formatted += `, pris=${(sub.items[0].price / 100).toFixed(0)} kr`;
        formatted += '\n';
      });
    }
    const invoices = contextData.stripe.invoices || [];
    const unpaidStripe = invoices.filter((inv: any) => !inv.paid);
    if (unpaidStripe.length > 0) {
      formatted += `Obetalda fakturor (${unpaidStripe.length}):\n`;
      unpaidStripe.forEach((inv: any) => {
        formatted += `  - ${inv.id}: ${inv.amount ? (inv.amount / 100).toFixed(0) + ' kr' : '?'}, förfaller ${inv.dueDate ? new Date(inv.dueDate * 1000).toLocaleDateString('sv-SE') : 'okänt'}\n`;
      });
    }
    const charges = contextData.stripe.charges || [];
    if (charges.length > 0) {
      formatted += `Senaste betalningar: ${charges.slice(0, 3).map((c: any) => `${c.amount ? (c.amount / 100).toFixed(0) + ' kr' : '?'} (${c.status})`).join(', ')}\n`;
    }
  }

  if (contextData.billecta) {
    hasData = true;
    const b = contextData.billecta;
    formatted += '\n--- Fakturering ---\n';
    if (b.debtorName) formatted += `Kundnamn: ${b.debtorName}\n`;
    if (b.debtorOrgNo) formatted += `Org/personnr: ${b.debtorOrgNo}\n`;
    if (b.debtorStatus) {
      formatted += `Kontostatus: ${b.debtorStatus}`;
      if (b.debtorClosedDate) formatted += ` (stängt ${new Date(b.debtorClosedDate).toLocaleDateString('sv-SE')})`;
      formatted += '\n';
    }
    const invoices = b.invoices || [];
    const unpaid = invoices.filter((inv: any) => !inv.isPaid);
    const paid = invoices.filter((inv: any) => inv.isPaid);
    if (unpaid.length > 0) {
      formatted += `Obetalda fakturor (${unpaid.length}):\n`;
      unpaid.forEach((inv: any) => {
        formatted += `  - Faktura #${inv.number || inv.id}: ${inv.amount ?? '?'} kr, förfaller ${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('sv-SE') : 'okänt'}, status: ${inv.status || 'okänd'}${inv.deliveryMethod ? `, leverans: ${inv.deliveryMethod}` : ''}\n`;
      });
    }
    if (paid.length > 0) {
      formatted += `Betalda fakturor (${paid.length}): `;
      formatted += paid.slice(0, 3).map((inv: any) => `#${inv.number || inv.id} (${inv.amount ?? '?'} kr)`).join(', ');
      if (paid.length > 3) formatted += ` + ${paid.length - 3} till`;
      formatted += '\n';
    }
  }

  if (contextData.gmail) {
    hasData = true;
    formatted += `\n--- E-posthistorik ---\nTidigare konversationer med kunden: ${contextData.gmail.totalEmails || 0}\n`;
  }

  if (contextData.resend) {
    hasData = true;
    formatted += `\n--- Skickade mail ---\nAntal skickade mail: ${contextData.resend.emailsSent || 0}\n`;
  }

  if (!hasData) return '';
  return formatted;
}

// --- Previous Ticket History ---

async function findPreviousTicketContext(
  tenantId: string,
  customerEmail: string,
  currentTicketId?: string
): Promise<string> {
  try {
    const previousTickets = await prisma.ticket.findMany({
      where: {
        tenantId,
        customerEmail,
        status: { in: ['sent', 'closed'] },
        ...(currentTicketId ? { id: { not: currentTicketId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        subject: true,
        originalMessage: true,
        finalResponse: true,
        status: true,
        createdAt: true,
      },
    });

    if (previousTickets.length === 0) return '';

    let formatted = '\n\n=== KUNDENS TIDIGARE ÄRENDEN (Använd för sammanhängande support, undvik att upprepa) ===\n';
    (previousTickets as PreviousTicketRow[]).forEach((t: PreviousTicketRow, idx: number) => {
      formatted += `\nÄrende ${idx + 1} (${new Date(t.createdAt).toLocaleDateString('sv-SE')}, ${t.status}):\n`;
      formatted += `  Ämne: ${t.subject}\n`;
      formatted += `  Kund: ${t.originalMessage.replace(/\[Gmail ID:.*?\]\n?\[Inbox account:.*?\]\n?\n?/g, '').substring(0, 500).trim()}\n`;
      if (t.finalResponse) {
        formatted += `  Vårt svar: ${t.finalResponse.substring(0, 500)}\n`;
      }
    });

    return formatted;
  } catch (error) {
    console.error('[AI] Error fetching previous tickets:', error);
    return '';
  }
}

// --- Structured AI Output ---

interface AIStructuredOutput {
  response: string;
  confidence: number; // 0.0–1.0, model's own estimate
  usedKbArticleIds: string[];
  missingInfo: string; // empty string if no info missing
}

function parseStructuredOutput(raw: string): AIStructuredOutput | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.response === 'string' && parsed.response.length > 0) {
      return {
        response: parsed.response,
        confidence: typeof parsed.confidence === 'number' ? Math.min(Math.max(parsed.confidence, 0), 1) : 0.5,
        usedKbArticleIds: Array.isArray(parsed.usedKbArticleIds) ? parsed.usedKbArticleIds : [],
        missingInfo: typeof parsed.missingInfo === 'string' ? parsed.missingInfo : '',
      };
    }
  } catch (_) { /* fall through */ }
  return null;
}

// --- Main Generation Function ---

export async function generateAIResponse(
  subject: string,
  originalMessage: string,
  contextData?: any,
  tenantId?: string,
  ticketId?: string,
  customerEmail?: string,
  customerName?: string
): Promise<{ response: string; confidence: number }> {
  try {
    const contextPrompt = formatContextForPrompt(contextData);
    const hasContext = contextPrompt.length > 0;

    const [knowledgeResult, learningPrompt, previousTicketsPrompt] = await Promise.all([
      tenantId ? findRelevantKnowledge(tenantId, subject, originalMessage) : Promise.resolve({ formatted: '', citedIds: [] }),
      tenantId ? findLearningExamples(tenantId, subject, originalMessage) : Promise.resolve(''),
      (tenantId && customerEmail) ? findPreviousTicketContext(tenantId, customerEmail, ticketId) : Promise.resolve(''),
    ]);

    const hasKnowledge = knowledgeResult.formatted.length > 0;
    const hasPreviousTickets = previousTicketsPrompt.length > 0;
    const hasLearning = learningPrompt.length > 0;

    const greeting = customerName ? `Hej ${customerName.split(' ')[0]},` : 'Hej,';

    const systemPrompt = `Du är en professionell, empatisk och hjälpsam kundtjänstmedarbetare för Doldadress.

DITT UPPDRAG: Ge ett korrekt, tydligt och personligt svar som löser kundens problem.

VIKTIGA REGLER:

1. SPRÅK: Svara på SAMMA SPRÅK som kunden skriver på.

2. KUNSKAPSBAS = SANNING:
   - Basera svaret ALLTID på kunskapsbasartiklarna nedan när de är relevanta.
   - Hitta INTE på policys, priser, villkor eller processer som inte finns där.
   - Om kunskapsbasen beskriver specifika steg, URL:er eller "Mina sidor" — inkludera dem exakt.
   - Notera vilka artikel-ID:n du använder i ditt JSON-svar (fältet usedKbArticleIds).

3. KUNDDATA: Om faktura- eller prenumerationsdata finns:
   - Referera till specifika fakturanummer, belopp och datum.
   - Nämn ALDRIG systemnamn (Stripe, Billecta, Resend, OpenAI) — säg "vårt system" eller "våra register".

4. OSÄKERHET: Om du saknar information för att svara korrekt:
   - Skriv "Jag ska undersöka detta och återkommer till dig" — GISSA INTE.
   - Ange vilket behov du behöver kunden bekräfta i missingInfo-fältet.
   - Sätt confidence lågt (0.3–0.4).

5. FORMAT:
   - Börja med hälsning: "${greeting}"
   - Ge svaret tidigt — ingen lång inledning.
   - Punktlistor för instruktioner med flera steg.
   - Avsluta med "Hör av dig om du har fler frågor!" eller liknande.
   - Signera: "Vänliga hälsningar,\\nDoldadress Kundtjänst"
   - Längd: kort för enkla frågor, utförligare för komplexa.

6. TIDIGARE ÄRENDEN: Referera till tidigare kontakt om relevant. Upprepa inte redan given information.

DU SKA SVARA MED ENBART GILTIG JSON i detta format (inga markdown-block):
{
  "response": "<hela e-posttexten>",
  "confidence": <0.0–1.0 hur säker du är på att svaret är korrekt och fullständigt>,
  "usedKbArticleIds": ["<id1>", "<id2>"],
  "missingInfo": "<vad som saknas för att svara bättre, eller tom sträng>"
}`;

    const userContent = `Ämne: ${subject}\n\nKundens meddelande:\n${originalMessage}${contextPrompt}${previousTicketsPrompt}${knowledgeResult.formatted}${learningPrompt}`;

    const completion = await openai.chat.completions.create({
      model: MAIN_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 1500,
    });

    const rawOutput = completion.choices[0].message.content || '';
    const structured = parseStructuredOutput(rawOutput);

    let aiResponse: string;
    let modelConfidence: number;

    if (structured) {
      aiResponse = structured.response;
      modelConfidence = structured.confidence;
    } else {
      // Fallback: treat raw output as plain text response
      console.warn('[AI] Failed to parse structured JSON output, using raw text as fallback');
      aiResponse = rawOutput;
      modelConfidence = 0.5;
    }

    // --- Heuristic confidence adjustments on top of model self-report ---
    let confidence = modelConfidence;

    if (completion.choices[0].finish_reason === 'length') {
      confidence -= 0.15; // Response was cut off
    }

    if (hasKnowledge) confidence = Math.min(confidence + 0.08, 0.99);
    if (hasContext) confidence = Math.min(confidence + 0.04, 0.99);
    if (hasPreviousTickets) confidence = Math.min(confidence + 0.02, 0.99);
    if (hasLearning) confidence = Math.min(confidence + 0.03, 0.99);

    if (aiResponse.length < 50) confidence -= 0.15;
    else if (aiResponse.length < 100) confidence -= 0.08;

    if (aiResponse.includes('undersöka detta') || aiResponse.includes('återkommer')) {
      confidence = Math.min(confidence, 0.45);
    }

    return {
      response: aiResponse,
      confidence: Math.min(Math.max(confidence, 0.1), 0.99),
    };
  } catch (error) {
    console.error('[AI] Error generating AI response:', error);
    throw error;
  }
}
