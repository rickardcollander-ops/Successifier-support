import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db/client';
import type { KnowledgeBase } from '@/lib/types';
import { product } from '@/lib/products';
import { parseTicketThread, type ThreadEntry } from '@/lib/services/ticket-thread';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MAIN_MODEL = 'claude-sonnet-4-6';
const HELPER_MODEL = 'claude-haiku-4-5';

const RERANK_TOOL: Anthropic.Tool = {
  name: 'select_relevant_articles',
  description: 'Välj de mest relevanta kunskapsbasartiklarna för kundens fråga.',
  input_schema: {
    type: 'object',
    properties: {
      selected: {
        type: 'array',
        items: { type: 'integer' },
        description: '1-baserade artikelnummer (max 5). Tom array om ingen artikel är relevant.',
      },
    },
    required: ['selected'],
  },
};

const RESPONSE_TOOL: Anthropic.Tool = {
  name: 'submit_customer_response',
  description: 'Skicka det slutgiltiga kundsvaret till kunden.',
  input_schema: {
    type: 'object',
    properties: {
      response: {
        type: 'string',
        description: 'Hela e-posttexten som ska skickas till kunden, inklusive hälsning men UTAN signatur/avslutningshälsning (den läggs till automatiskt vid utskick).',
      },
      confidence: {
        type: 'number',
        description: 'Självskattad säkerhet 0.0–1.0 att svaret är korrekt och fullständigt.',
      },
      usedKbArticleIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'ID:n för de kunskapsbasartiklar du använde för att formulera svaret.',
      },
      missingInfo: {
        type: 'string',
        description: 'Vad som saknas för att svara bättre, eller tom sträng om inget saknas.',
      },
    },
    required: ['response', 'confidence', 'usedKbArticleIds', 'missingInfo'],
  },
};

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

        const rerank = await anthropic.messages.create({
          model: HELPER_MODEL,
          max_tokens: 300,
          system: 'Du är en sökmotor för kunskapsbas-artiklar. Välj de artiklar (max 5) som är mest relevanta för kundens fråga. Om ingen artikel är relevant, returnera en tom lista.',
          messages: [
            {
              role: 'user',
              content: `KUNDENS FRÅGA:\nÄmne: ${subject}\n${message.substring(0, 800)}\n\nTILLGÄNGLIGA ARTIKLAR:\n${candidateList}`,
            },
          ],
          tools: [RERANK_TOOL],
          tool_choice: { type: 'tool', name: 'select_relevant_articles' },
        });

        const toolUse = rerank.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        const input = (toolUse?.input ?? {}) as { selected?: unknown };
        const rawSelected = Array.isArray(input.selected) ? input.selected : [];
        const validIndices = rawSelected.filter(
          (i: unknown): i is number => typeof i === 'number' && i >= 1 && i <= candidates.length,
        );
        if (validIndices.length > 0) {
          selected = validIndices.map((i: number) => candidates[i - 1].kb);
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
        wasEdited: false, // Unedited = AI already got it right
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        subject: true,
        originalMessage: true,
        finalResponse: true,
      },
    });

    // Also fetch edited-but-approved ones as secondary pool
    const editedFeedback = await prisma.aIResponseFeedback.findMany({
      where: {
        tenantId,
        rating: 'positive',
        finalResponse: { not: null },
        wasEdited: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        subject: true,
        originalMessage: true,
        finalResponse: true,
        wasEdited: true,
        rating: true,
      },
    });

    const allFeedback = [...feedback, ...editedFeedback];
    if (allFeedback.length === 0) return '';

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
      // Format dates as ISO YYYY-MM-DD so the year is unambiguous. The AI
      // previously confused "currentPeriodEnd" (next renewal) with the
      // actual cancellation date, which made it answer "ends 2026" when
      // the customer's subscription is scheduled to end in 2027. The
      // EFFEKTIVT SLUTDATUM line below tells the AI exactly which date
      // the customer cares about.
      const fmtIso = (unix: number) => new Date(unix * 1000).toISOString().split('T')[0];
      subs.forEach((sub: any) => {
        formatted += `  - ${sub.id}: status=${sub.status}`;
        if (sub.currentPeriodEnd) formatted += `, nuvarande period slutar ${fmtIso(sub.currentPeriodEnd)}`;
        // canceledAt = the date the customer REQUESTED cancellation (not when
        // the subscription ends). Label it clearly and always print the actual
        // scheduled end date (cancelAt) so the AI never reports the request
        // year as the end year.
        if (sub.canceledAt) formatted += `, uppsägning begärd ${fmtIso(sub.canceledAt)}`;
        if (sub.endedAt) formatted += `, upphörd ${fmtIso(sub.endedAt)}`;
        if (sub.cancelAt) formatted += `, planerat slutdatum ${fmtIso(sub.cancelAt)}`;
        if (sub.items?.[0]?.price) formatted += `, pris=${(sub.items[0].price / 100).toFixed(0)} kr`;
        // Decide which date counts as "when does the subscription end?".
        // cancelAt > endedAt > currentPeriodEnd. Always print the year.
        const effectiveEnd = sub.endedAt || sub.cancelAt || sub.currentPeriodEnd;
        if (effectiveEnd) {
          const d = new Date(effectiveEnd * 1000);
          formatted += `\n    EFFEKTIVT SLUTDATUM (använd detta i svar till kund): ${fmtIso(effectiveEnd)} (år ${d.getUTCFullYear()})`;
        }
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
    if (unpaid.length > 0) {
      formatted += 'OBS: Fakturorna ovan märkta obetalda är INTE betalda av kunden. Ska en sådan faktura tas bort (t.ex. vid uppsägning eller felaktig fakturering) KREDITERAS den — säg "fakturan krediteras", inte "återbetalning". Återbetalning är bara aktuell för belopp kunden redan har betalat.\n';
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
      take: 10,
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

// --- Incoming message translation ---

// Translate a customer's message into the product's own language so support
// can read mail written in a foreign language (e.g. Serus, an English team,
// receiving French or German). Uses the cheap helper model and returns the
// translation as plain text. If the text is already in the target language
// the model is told to return it unchanged.
export async function translateToProductLanguage(text: string): Promise<string> {
  const targetLanguage = product.language === 'en' ? 'English' : 'Swedish';
  const completion = await anthropic.messages.create({
    model: HELPER_MODEL,
    max_tokens: 2000,
    system: `You are a translation engine. Translate the user's message into ${targetLanguage}. Preserve the meaning, tone and line breaks, and keep names, numbers, e-mail addresses and links exactly as written. If the text is already in ${targetLanguage}, return it unchanged. Output ONLY the translation — no preamble, explanations or quotation marks.`,
    messages: [{ role: 'user', content: text }],
  });
  const textBlock = completion.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  return textBlock?.text?.trim() ?? '';
}

// --- Main Generation Function ---

// Static system prompt — cacheable across requests (all dynamic content lives
// in the user message). Built per tenant from the ACTIVE config at call time
// (never captured at module scope), but byte-stable for a given tenant so
// the prompt cache still hits.
const systemPromptSv = (brandName: string) => `Du är en professionell, empatisk och hjälpsam kundtjänstmedarbetare för ${brandName}.

DITT UPPDRAG: Ge ett korrekt, tydligt och personligt svar som löser kundens problem.

VIKTIGA REGLER:

1. SPRÅK: Svara på SAMMA SPRÅK som kunden skriver på.

2. KUNSKAPSBAS = SANNING:
   - Basera svaret ALLTID på kunskapsbasartiklarna när de är relevanta.
   - Hitta INTE på policys, priser, villkor eller processer som inte finns där.
   - Om kunskapsbasen beskriver specifika steg, URL:er eller "Mina sidor" — inkludera dem exakt.
   - Notera vilka artikel-ID:n du använder i fältet usedKbArticleIds när du anropar verktyget.

3. KUNDDATA: Om faktura- eller prenumerationsdata finns:
   - Referera till specifika fakturanummer, belopp och datum.
   - Nämn ALDRIG systemnamn (Stripe, Billecta, Resend, OpenAI, Anthropic, Claude) — säg "vårt system" eller "våra register".
   - Skilj på KREDITERING och ÅTERBETALNING: en OBETALD faktura som inte ska betalas KREDITERAS (makuleras med kreditfaktura) — säg då att fakturan krediteras och kan bortses från, ALDRIG "återbetalning". Återbetalning gäller endast pengar kunden redan har betalat.

4. OSÄKERHET: Om du saknar information för att svara korrekt:
   - Skriv "Jag ska undersöka detta och återkommer till dig" — GISSA INTE.
   - Ange i fältet missingInfo vad du behöver få bekräftat av kunden.
   - Sätt confidence lågt (0.3–0.4).

5. FORMAT:
   - Börja svaret med den hälsningsfras som anges under "HÄLSNING" i användarmeddelandet nedan.
   - Ge svaret tidigt — ingen lång inledning. Hoppa över tomma empatifraser som "Jag förstår att…" om de inte tillför något konkret.
   - Skriv REN TEXT — ingen markdown. Använd ALDRIG **fetstil**, *kursiv*, #-rubriker, backticks eller [text](länk). Skriv länkar som råa URL:er (t.ex. https://www.example.com/support). Mejlet skickas som vanlig text, så markdown-tecken som ** visas bokstavligen för kunden.
   - Var koncis men FULLSTÄNDIG: svara på allt kunden tar upp och förklara det kunden behöver veta — hellre ett komplett och vänligt svar än ett avhugget. Undvik upprepningar och självklara mellansteg. För instruktioner: lista de nödvändiga stegen, en rad per steg (t.ex. "1. …").
   - Avsluta kort och vänligt och variera avslutet. Undvik den slitna standardfrasen "Hör av dig om du har fler frågor".
   - Skriv INGEN signatur eller avslutningshälsning (t.ex. "Vänliga hälsningar", "Med vänlig hälsning", namn eller företagsnamn). Signaturen läggs till automatiskt vid utskick.
   - Längd: kort för enkla frågor, utförligare för komplexa.

6. TIDIGARE ÄRENDEN: Referera till tidigare kontakt om relevant. Upprepa inte redan given information.

7. PÅGÅENDE KONVERSATION: När användarmeddelandet innehåller "KONVERSATIONEN HITTILLS": läs HELA tidslinjen i kronologisk ordning så att du förstår vad kunden och support redan har sagt. Svara på kundens SENASTE meddelande i ljuset av historiken — upprepa inte det support redan har svarat, och backa inte på besked som redan getts utan ny information. Innehåll märkt "INTERN ANTECKNING" får ALDRIG citeras eller avslöjas för kunden.

SVARSLEVERANS: Leverera ALLTID ditt svar genom att anropa verktyget submit_customer_response. Hela e-posttexten (inklusive hälsning men UTAN signatur) ska ligga i fältet "response".`;

// Serus replies are always written in English, with special handling for
// other languages: German gets a German version stacked on top of the
// English one, and any other non-English language gets the customer's
// question translated to English (clearly labelled) above the English answer.
const SERUS_LANGUAGE_RULE = `1. LANGUAGE (IMPORTANT — Serus always replies in English):
   - Write your answer to the customer in ENGLISH, no matter what language the customer wrote in.
   - If the customer wrote in GERMAN: put the full answer in GERMAN first (with a German greeting), then a line containing only "---", then the same full answer in ENGLISH below (using the greeting from "GREETING").
   - If the customer wrote in ANY OTHER non-English language (e.g. French, Spanish, Italian): answer in English only. Begin the reply with the customer's question translated into English on its own line, clearly marked with the source language like "[Translated from French] <question in English>". Leave a blank line, then give your English answer starting with the greeting from "GREETING".
   - If the customer wrote in ENGLISH: just answer in English, no translation block, starting with the greeting from "GREETING".`;

const ENGLISH_LANGUAGE_RULE = `1. LANGUAGE: Reply in the SAME LANGUAGE the customer writes in.`;

const systemPromptEn = (brandName: string, productKey: string) => `You are a professional, empathetic and helpful customer service agent for ${brandName}.

YOUR MISSION: Give a correct, clear and personal answer that solves the customer's problem.

IMPORTANT RULES:

${productKey === 'serus' ? SERUS_LANGUAGE_RULE : ENGLISH_LANGUAGE_RULE}

2. KNOWLEDGE BASE = TRUTH:
   - ALWAYS base the answer on the knowledge base articles when they are relevant.
   - Do NOT make up policies, prices, terms or processes that are not there.
   - If the knowledge base describes specific steps, URLs or "My pages" — include them exactly.
   - Note which article IDs you used in the usedKbArticleIds field when you call the tool.

3. CUSTOMER DATA: If invoice or subscription data is available:
   - Reference specific invoice numbers, amounts and dates.
   - NEVER mention system names (Stripe, Clerk, OpenAI, Anthropic, Claude) — say "our system" or "our records".
   - Distinguish CREDIT NOTES from REFUNDS: an UNPAID invoice that should not be paid is CREDITED (cancelled with a credit note) — say the invoice will be credited, NEVER "refund". A refund only applies to money the customer has already paid.

4. UNCERTAINTY: If you lack the information to answer correctly:
   - Write "I'll look into this and get back to you" — DO NOT GUESS.
   - State in the missingInfo field what you need confirmed by the customer.
   - Set confidence low (0.3–0.4).

5. FORMAT:
   - Begin the reply with the greeting given under "GREETING" in the user message below.
   - Give the answer early — no long introduction. Skip empty empathy fillers like "I understand that…" unless they add something concrete.
   - Write PLAIN TEXT — no markdown. NEVER use **bold**, *italics*, # headings, backticks or [text](link). Write links as raw URLs. The email is sent as plain text, so markdown characters like ** appear literally to the customer.
   - Be concise but COMPLETE: address everything the customer brings up and explain what they need to know — a complete, friendly answer beats a clipped one. Avoid repetition and obvious intermediate steps. For instructions, list the necessary steps, one per line (e.g. "1. …").
   - End briefly and warmly, and vary the closing. Avoid the worn-out stock phrase "Let me know if you have any further questions".
   - Do NOT write any signature or sign-off (e.g. "Best regards", "Kind regards", a name or a company name). The signature is added automatically when the reply is sent.
   - Length: short for simple questions, more detailed for complex ones.

6. PREVIOUS TICKETS: Reference previous contact when relevant. Do not repeat information already given.

7. ONGOING CONVERSATION: When the user message contains "THE CONVERSATION SO FAR": read the WHOLE timeline in chronological order so you understand what the customer and support have already said. Answer the customer's LATEST message in light of that history — do not repeat what support has already answered, and do not contradict commitments already given unless there is new information. Content marked "INTERNAL NOTE" must NEVER be quoted or revealed to the customer.

RESPONSE DELIVERY: ALWAYS deliver your answer by calling the submit_customer_response tool. The full email text (including the greeting but WITHOUT a signature) must be in the "response" field.`;

/** The active tenant's system prompt (stable per tenant → prompt-cacheable). */
function staticSystemPrompt(): string {
  return product.language === 'en'
    ? systemPromptEn(product.brandName, product.key)
    : systemPromptSv(product.brandName);
}

export async function generateAIResponse(
  subject: string,
  originalMessage: string,
  contextData?: any,
  tenantId?: string,
  ticketId?: string,
  customerEmail?: string,
  customerName?: string
): Promise<{ response: string; confidence: number; knowledgeUsed: string[] }> {
  try {
    const contextPrompt = formatContextForPrompt(contextData);
    const hasContext = contextPrompt.length > 0;

    // Open tickets accumulate the whole conversation in originalMessage
    // (follow-ups, support replies, internal comments). Parse it so the
    // model gets an explicit timeline and knows which customer message
    // is the one to answer — instead of one undifferentiated blob.
    const thread = parseTicketThread(originalMessage);
    const customerEntries = thread.filter((e: ThreadEntry) => e.role === 'customer');
    const latestCustomer = customerEntries[customerEntries.length - 1];
    const hasThread = thread.length > 1 && !!latestCustomer;

    // KB retrieval and learning examples should match what the customer is
    // asking about NOW: latest customer message first (the rerank prompt
    // only sees the first 800 chars), earlier customer messages after,
    // and no support replies/internal notes polluting the keyword scoring.
    const retrievalText = hasThread
      ? [latestCustomer.body, ...customerEntries.slice(0, -1).map((e: ThreadEntry) => e.body)].join('\n\n')
      : (thread[0]?.body ?? originalMessage);

    const [knowledgeResult, learningPrompt, previousTicketsPrompt] = await Promise.all([
      tenantId ? findRelevantKnowledge(tenantId, subject, retrievalText) : Promise.resolve({ formatted: '', citedIds: [] }),
      tenantId ? findLearningExamples(tenantId, subject, retrievalText) : Promise.resolve(''),
      (tenantId && customerEmail) ? findPreviousTicketContext(tenantId, customerEmail, ticketId) : Promise.resolve(''),
    ]);

    const hasKnowledge = knowledgeResult.formatted.length > 0;
    const hasPreviousTickets = previousTicketsPrompt.length > 0;
    const hasLearning = learningPrompt.length > 0;

    // Extract customer first name for greeting (use provided name, then email prefix as fallback)
    let customerFirstName = '';
    if (customerName) {
      customerFirstName = customerName.split(/\s+/)[0];
    } else if (customerEmail) {
      const localPart = customerEmail.split('@')[0].replace(/[._\-+]/g, ' ').trim();
      // Only use if it looks like a real name (not e.g. "info", "support", "noreply")
      const genericPrefixes = new Set(['info', 'support', 'kontakt', 'noreply', 'no-reply', 'admin', 'hej', 'mail', 'post']);
      if (!genericPrefixes.has(localPart.toLowerCase())) {
        customerFirstName = localPart.split(/\s+/)[0];
        // Capitalize first letter
        customerFirstName = customerFirstName.charAt(0).toUpperCase() + customerFirstName.slice(1).toLowerCase();
      }
    }

    const greeting = product.language === 'en'
      ? (customerFirstName ? `Hi ${customerFirstName},` : 'Hi,')
      : (customerFirstName ? `Hej ${customerFirstName},` : 'Hej,');
    const greetingLabel = product.language === 'en' ? 'GREETING' : 'HÄLSNING';

    const en = product.language === 'en';
    const roleLabel = (e: ThreadEntry) =>
      e.role === 'customer'
        ? (en ? 'CUSTOMER' : 'KUNDEN')
        : e.role === 'support'
          ? (en ? 'SUPPORT (our reply)' : 'SUPPORT (vårt svar)')
          : (en ? 'INTERNAL NOTE (never shown to the customer)' : 'INTERN ANTECKNING (visas aldrig för kunden)');

    const messageSection = hasThread
      ? `=== ${en ? 'THE CONVERSATION SO FAR' : 'KONVERSATIONEN HITTILLS'} (${en ? 'oldest first' : 'äldst först'}) ===\n${thread
          .map((e: ThreadEntry) => `\n--- ${roleLabel(e)}${e.date ? ` · ${e.date}` : ''} ---\n${e.body}`)
          .join('\n')}\n\n=== ${en ? "CUSTOMER'S LATEST MESSAGE (this is what you reply to)" : 'KUNDENS SENASTE MEDDELANDE (det är detta du ska svara på)'} ===\n${latestCustomer!.body}`
      : `Kundens meddelande:\n${thread[0]?.body ?? originalMessage}`;

    const userContent = `${greetingLabel}: ${greeting}\n\nÄmne: ${subject}\n\n${messageSection}${contextPrompt}${previousTicketsPrompt}${knowledgeResult.formatted}${learningPrompt}`;

    const completion = await anthropic.messages.create({
      model: MAIN_MODEL,
      max_tokens: 2000,
      temperature: 0.4,
      system: [
        {
          type: 'text',
          text: staticSystemPrompt(),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userContent }],
      tools: [RESPONSE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_customer_response' },
    });

    const toolUse = completion.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    let aiResponse: string;
    let modelConfidence: number;

    if (toolUse) {
      const input = toolUse.input as {
        response?: unknown;
        confidence?: unknown;
      };
      if (typeof input.response === 'string' && input.response.length > 0) {
        aiResponse = input.response;
        modelConfidence = typeof input.confidence === 'number'
          ? Math.min(Math.max(input.confidence, 0), 1)
          : 0.5;
      } else {
        console.warn('[AI] Tool response missing/empty, falling back to text block');
        const textBlock = completion.content.find(
          (b): b is Anthropic.TextBlock => b.type === 'text',
        );
        aiResponse = textBlock?.text ?? '';
        modelConfidence = 0.5;
      }
    } else {
      // Fallback: treat any text block as the response
      console.warn('[AI] No tool_use block found, falling back to text block');
      const textBlock = completion.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      aiResponse = textBlock?.text ?? '';
      modelConfidence = 0.5;
    }

    // --- Heuristic confidence adjustments on top of model self-report ---
    let confidence = modelConfidence;

    if (completion.stop_reason === 'max_tokens') {
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
      knowledgeUsed: knowledgeResult.citedIds,
    };
  } catch (error) {
    console.error('[AI] Error generating AI response:', error);
    throw error;
  }
}
