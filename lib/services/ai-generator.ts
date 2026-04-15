import OpenAI from 'openai';
import { prisma } from '@/lib/db/client';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Swedish-aware text processing ---

const SWEDISH_STOPWORDS = new Set([
  'och', 'det', 'att', 'en', 'ett', 'är', 'på', 'för', 'med', 'av', 'till',
  'som', 'har', 'inte', 'om', 'från', 'den', 'de', 'ska', 'var', 'kan',
  'men', 'vi', 'jag', 'du', 'han', 'hon', 'sin', 'sig', 'hur', 'när',
  'vad', 'vem', 'har', 'hade', 'vara', 'bli', 'bli', 'mer', 'mot', 'vid',
  'min', 'din', 'han', 'hon', 'dem', 'ni', 'mig', 'dig', 'oss', 'er',
  'hej', 'tack', 'mvh', 'vänliga', 'hälsningar', 'the', 'and', 'or', 'is',
]);

/**
 * Strips common Swedish inflectional suffixes to normalize words for matching.
 * E.g. "fakturan" → "faktur", "prenumerationer" → "prenumeration"
 */
function sweStem(word: string): string {
  if (word.length < 5) return word;
  // Definite plural forms first (longer suffixes first)
  const suffixes = ['ationerna', 'ningarna', 'ationerna', 'elserna', 'arerna',
    'ationens', 'ingarnas', 'ningars', 'orernas', 'ationens',
    'elsernas', 'ingarna', 'arernas', 'ationens',
    'ningarna', 'ationerna',
    'ationens', 'ationerna',
    'ationer', 'ationens', 'ationers',
    'ningarna', 'ningars', 'ningarnas',
    'ationerna',
    'ationens',
    'elserna', 'elsernas', 'elsers',
    'arerna', 'arernas', 'arers',
    'orerna', 'orernas', 'orers',
    'ningarna', 'ningarnas', 'ningars',
    'ationerna', 'ationernas', 'ationers',
    'ningar', 'ningens', 'ningens',
    'ationens', 'ationers',
    'elsers', 'ationens',
    'ningens', 'ationers',
    'ationer', 'ningar', 'ningen', 'ningens',
    'ationens', 'ationen',
    'elserna', 'ationen',
    'ningar', 'ningen',
    'arerna', 'arnas',
    'orerna', 'ornas',
    'ernas', 'arnas', 'ornas',
    'andes', 'andes',
    'anden', 'andet',
    'ernas', 'arnas', 'ornas',
    'ation', 'ning', 'else',
    'ernas', 'arnas', 'ornas',
    'anden', 'andet', 'andes',
    'ande', 'andes',
    'ernas', 'arnas', 'ornas',
    'erna', 'arna', 'orna',
    'ande', 'andes',
    'erna', 'arna', 'orna',
    'ades', 'ades',
    'ande', 'erna', 'arna', 'orna',
    'ade', 'ades',
    'ens', 'ers', 'ars', 'ors',
    'are', 'ast',
    'ens', 'ers',
    'ade', 'ares',
    'ens', 'ers',
    'en', 'et', 'ar', 'or', 'er', 'na', 'ns', 'ts',
    's',
  ];
  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/**
 * Tokenize text into meaningful words: lowercase, remove stopwords, strip punctuation, stem.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zåäö0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !SWEDISH_STOPWORDS.has(w))
    .map(sweStem)
    .filter(w => w.length > 2);
}

/**
 * Extract bigrams (word pairs) from a token list for phrase matching.
 */
function bigrams(tokens: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    result.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return result;
}

// --- Synonym/keyword groups (expanded for Swedish support domain) ---

const KEYWORD_GROUPS: Record<string, string[]> = {
  uppsägning: ['säga upp', 'säger upp', 'avsluta', 'avslutar', 'stänga', 'cancel',
    'cancellation', 'terminate', 'sluta', 'inte vill ha', 'vill inte ha',
    'avslut', 'uppsäg', 'avbryta', 'avbryt', 'upphör'],
  faktura: ['invoice', 'räkning', 'betalning', 'betala', 'obetald', 'förfallen',
    'förfaller', 'bill', 'belopp', 'fakturor', 'kreditfaktura', 'avgift',
    'skuld', 'fakturanummer', 'fakturadatum', 'förfallodatum'],
  abonnemang: ['prenumeration', 'subscription', 'plan', 'förnyelse', 'förnya',
    'period', 'månadskostnad', 'årsabonnemang', 'månadsabonnemang', 'paket'],
  leverans: ['leverera', 'delivery', 'frakt', 'skicka', 'skickad', 'posta', 'brev',
    'kivra', 'e-faktura', 'efaktura', 'digitalt', 'brevlåda', 'utskick'],
  inloggning: ['logga in', 'login', 'lösenord', 'password', 'konto', 'mina sidor',
    'account', 'glömt lösenord', 'återställa', 'inloggningsproblem', 'access'],
  adress: ['address', 'adressändring', 'flytta', 'flytt', 'ny adress',
    'ändra adress', 'byta adress', 'ny bostad', 'omflyttning', 'folkbokföringsadress'],
  betalning: ['swish', 'kort', 'card', 'autogiro', 'bankgiro', 'betalt',
    'betalat', 'payment', 'kreditkort', 'bankkort', 'direktbetalning', 'ocr'],
  reklamation: ['klaga', 'complaint', 'missnöjd', 'fel', 'problem', 'fungerar inte',
    'trasig', 'skadat', 'felaktig', 'felaktigt', 'klagomål', 'inte nöjd'],
  pris: ['kostnad', 'kostar', 'priset', 'prisändring', 'ny prislista', 'höjning',
    'sänkning', 'rabatt', 'erbjudande', 'kampanj', 'värde'],
  återbetalning: ['återbetala', 'refund', 'pengar tillbaka', 'kreditera', 'gottgöra',
    'kompensation', 'ersättning'],
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

// --- Knowledge Base Matching ---

async function findRelevantKnowledge(tenantId: string, message: string): Promise<{ items: any[]; formatted: string }> {
  try {
    const knowledgeBase = await prisma.knowledgeBase.findMany({
      where: { tenantId, isActive: true },
    });

    if (knowledgeBase.length === 0) return { items: [], formatted: '' };

    const messageLower = message.toLowerCase();
    const tokens = tokenize(message);
    const messageBigrams = bigrams(tokens);
    const expandedTerms = expandKeywords(messageLower);
    const expandedTokens = tokenize(expandedTerms.join(' '));

    type KbItem = typeof knowledgeBase[0];
    type ScoredKb = { kb: KbItem; score: number };
    const scored: ScoredKb[] = knowledgeBase
      .map((kb: KbItem) => {
        const titleLower = kb.title.toLowerCase();
        const contentLower = kb.content.toLowerCase();
        const titleTokens = tokenize(kb.title);
        const contentTokens = tokenize(kb.content);
        const titleBigrams = bigrams(titleTokens);

        let score = 0;

        // Exact title substring (high value)
        if (messageLower.includes(titleLower)) score += 20;
        if (titleLower.includes(messageLower.substring(0, 50))) score += 10;

        // Stemmed token overlap in title
        const titleTokenMatches = tokens.filter(t => titleTokens.includes(t)).length;
        score += titleTokenMatches * 4;

        // Stemmed token overlap in content (capped to avoid long articles dominating)
        const contentTokenMatches = tokens.filter(t => contentTokens.includes(t)).length;
        score += Math.min(contentTokenMatches * 1.5, 12);

        // Bigram phrase matching in title (high signal)
        const titleBigramMatches = messageBigrams.filter(bg => titleBigrams.includes(bg)).length;
        score += titleBigramMatches * 8;

        // Tag matching (stemmed)
        const tagScore = kb.tags.reduce((acc: number, tag: string) => {
          const tagTokens = tokenize(tag);
          const directHit = messageLower.includes(tag.toLowerCase()) ? 6 : 0;
          const tokenHit = tokens.some(t => tagTokens.includes(t)) ? 3 : 0;
          return acc + directHit + tokenHit;
        }, 0);
        score += Math.min(tagScore, 15);

        // Synonym/keyword expansion matching
        if (expandedTokens.length > 0) {
          const expandedTitleMatches = expandedTokens.filter(t => titleTokens.includes(t)).length;
          const expandedContentMatches = expandedTokens.filter(t => contentTokens.includes(t)).length;
          score += expandedTitleMatches * 6;
          score += Math.min(expandedContentMatches * 2, 8);
        }

        // Category matching
        if (kb.category) {
          const catTokens = tokenize(kb.category);
          if (tokens.some(t => catTokens.includes(t))) score += 3;
          if (expandedTokens.some(t => catTokens.includes(t))) score += 3;
        }

        // Slightly deprioritize auto-learned articles
        if (kb.category === 'Lärande från skickade svar') {
          score *= 0.65;
        }

        return { kb, score };
      })
      .filter(({ score }: ScoredKb) => score > 3)
      .sort((a: ScoredKb, b: ScoredKb) => b.score - a.score)
      .slice(0, 6);

    if (scored.length === 0) return { items: [], formatted: '' };

    const items = scored.map(({ kb }) => kb);

    let formatted = '\n\n=== KUNSKAPSBAS (KRITISK: Basera ditt svar på detta) ===\n';
    scored.forEach(({ kb }) => {
      formatted += `\n--- ${kb.title}${kb.category ? ` [${kb.category}]` : ''} ---\n`;
      formatted += `${kb.content}\n`;
    });

    return { items, formatted };
  } catch (error) {
    console.error('Error fetching knowledge base:', error);
    return { items: [], formatted: '' };
  }
}

// --- Learning Examples ---

async function findLearningExamples(tenantId: string, message: string, subject: string): Promise<string> {
  try {
    const tokens = tokenize(`${subject} ${message}`);
    if (tokens.length === 0) return '';

    // Fetch a wider pool to find the best matches
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
      },
    });

    const allFeedback = [...feedback, ...editedFeedback];
    if (allFeedback.length === 0) return '';

    const scored = allFeedback
      .map(fb => {
        const fbTokens = tokenize(`${fb.subject} ${fb.originalMessage}`);
        const matchCount = tokens.filter(t => fbTokens.includes(t)).length;
        // Normalize by token count to avoid short messages always losing
        const normalizedScore = tokens.length > 0 ? matchCount / tokens.length : 0;
        return { fb, score: normalizedScore };
      })
      .filter(({ score }) => score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (scored.length === 0) return '';

    let formatted = '\n\n=== EXEMPEL PÅ GODKÄNDA SVAR (Inspireras av ton och format) ===\n';
    scored.forEach(({ fb }, index) => {
      formatted += `\nExempel ${index + 1}:\n`;
      formatted += `Kundens ämne: ${fb.subject}\n`;
      formatted += `Kund skrev: ${fb.originalMessage.substring(0, 200)}\n`;
      formatted += `Godkänt svar: ${fb.finalResponse?.substring(0, 400) || 'N/A'}\n`;
    });

    return formatted;
  } catch (error) {
    console.error('Error fetching learning examples:', error);
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
      formatted += `Obetalda fakturor: ${unpaidStripe.length}\n`;
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
    formatted += `\n--- E-posthistorik ---\nTidigare mailkonversationer med kunden: ${contextData.gmail.totalEmails || 0}\n`;
  }

  if (contextData.resend) {
    hasData = true;
    formatted += `\n--- Utskickad e-post ---\nAntal skickade mail: ${contextData.resend.emailsSent || 0}\n`;
  }

  if (!hasData) return '';
  return formatted;
}

// --- Previous Ticket History ---

async function findPreviousTicketContext(tenantId: string, customerEmail: string, currentTicketId?: string, subject?: string): Promise<string> {
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

    // Score by relevance if we have a subject to compare to
    const tokens = subject ? tokenize(subject) : [];
    type PrevTicket = typeof previousTickets[0];
    const scored = previousTickets.map((t: PrevTicket) => {
      const tTokens = tokenize(`${t.subject} ${t.originalMessage.substring(0, 200)}`);
      const matchScore = tokens.length > 0
        ? tokens.filter((tk: string) => tTokens.includes(tk)).length / tokens.length
        : 0;
      return { t, relevance: matchScore };
    });

    // Keep the 3 most relevant + always keep the most recent if not already included
    const topRelevant = scored
      .sort((a: { t: PrevTicket; relevance: number }, b: { t: PrevTicket; relevance: number }) => b.relevance - a.relevance)
      .slice(0, 3)
      .map((s: { t: PrevTicket; relevance: number }) => s.t);

    const mostRecent = previousTickets[0];
    const showTickets = topRelevant.some((t: PrevTicket) => t === mostRecent)
      ? topRelevant
      : [mostRecent, ...topRelevant.slice(0, 2)];

    let formatted = '\n\n=== KUNDENS TIDIGARE ÄRENDEN ===\n';
    showTickets.forEach((t: PrevTicket, idx: number) => {
      formatted += `\nÄrende ${idx + 1} (${new Date(t.createdAt).toLocaleDateString('sv-SE')}, ${t.status}):\n`;
      formatted += `  Ämne: ${t.subject}\n`;
      formatted += `  Kund: ${t.originalMessage.substring(0, 200).replace(/\[Gmail ID:.*?\]\n?\[Inbox account:.*?\]\n?\n?/g, '').trim()}\n`;
      if (t.finalResponse) {
        formatted += `  Vårt svar: ${t.finalResponse.substring(0, 250)}\n`;
      }
    });

    return formatted;
  } catch (error) {
    console.error('Error fetching previous tickets:', error);
    return '';
  }
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
): Promise<{ response: string; confidence: number; knowledgeUsed: string[] }> {
  try {
    const fullQuery = `${subject} ${originalMessage}`;

    const [contextPrompt, knowledgeResult, learningPrompt, previousTicketsPrompt] = await Promise.all([
      Promise.resolve(formatContextForPrompt(contextData)),
      tenantId ? findRelevantKnowledge(tenantId, fullQuery) : Promise.resolve({ items: [], formatted: '' }),
      tenantId ? findLearningExamples(tenantId, originalMessage, subject) : Promise.resolve(''),
      (tenantId && customerEmail)
        ? findPreviousTicketContext(tenantId, customerEmail, ticketId, subject)
        : Promise.resolve(''),
    ]);

    const { items: knowledgeItems, formatted: knowledgePrompt } = knowledgeResult;
    const hasKnowledge = knowledgePrompt.length > 0;
    const hasContext = contextPrompt.length > 0;
    const hasPreviousTickets = previousTicketsPrompt.length > 0;

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

    const greeting = customerFirstName ? `Hej ${customerFirstName},` : 'Hej,';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Du är en professionell och empatisk kundtjänstmedarbetare för Doldadress – en tjänst för hemlig adress/skyddad adress.

════════════════════════════════════
PRIORITETSORDNING FÖR DITT SVAR:
1. Kunskapsbasen (absolut sanning – avvik aldrig)
2. Kundinformation från systemet (fakturor, prenumerationer)
3. Tidigare ärenden (ge sammanhängande upplevelse)
4. Din egna formulering (ton, struktur, empati)
════════════════════════════════════

OBLIGATORISKA REGLER:

▸ KUNSKAPSBAS ÄR LAG
  – Om kunskapsbasartiklar finns: basera HELA svaret på dem.
  – Lägg INTE till policys, priser, processer eller löften som inte finns i kunskapsbasen.
  – Om artikeln nämner "Mina sidor", specifika webbadresser eller steg – ta med dem exakt.

▸ KUNDDATA
  – Referera till konkreta fakturanummer, belopp och datum om de är relevanta för frågan.
  – Om kunden frågar om en obetald faktura och data finns – bekräfta det artigt.
  – Nämn ALDRIG Stripe, Billecta eller andra systemnamn – säg "vårt system" eller "våra register".

▸ OSÄKERHET
  – Vet du inte svaret? Skriv: "Jag behöver kontrollera detta och återkommer till dig."
  – Gissa ALDRIG priser, datum, policys eller tekniska detaljer.

▸ SPRÅK
  – Svara på SAMMA SPRÅK som kunden. Svenska → svenska. Engelska → engelska. Etc.

▸ FORMAT OCH TON
  – Inled med: "${greeting}" (använd det exakta hälsningsnamnet).
  – Ge svaret direkt efter hälsningen – ingen lång inledning.
  – Använd punktlistor för steg-för-steg-instruktioner.
  – Håll svaret lagom långt: enkla frågor = 2–4 meningar, komplexa = utförligare.
  – Avsluta med: "Hör av dig om du har fler frågor!" eller liknande.
  – Signera alltid: "Vänliga hälsningar,\\nDoldadress Kundtjänst"

▸ FÖRBJUDET
  – Hitta aldrig på policy, pris, leveranstid eller villkor.
  – Lova aldrig specifika datum om du inte har dem.
  – Avslöja aldrig intern systeminformation.`,
        },
        {
          role: 'user',
          content: `Ämne: ${subject}\n\nKundens meddelande:\n${originalMessage}${contextPrompt}${previousTicketsPrompt}${knowledgePrompt}${learningPrompt}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1200,
    });

    const aiResponse = completion.choices[0].message.content || '';
    const finishReason = completion.choices[0].finish_reason;

    // --- Confidence scoring ---
    let confidence = 0.70;

    if (finishReason === 'stop') {
      confidence += 0.08;
    } else if (finishReason === 'length') {
      confidence -= 0.15; // Truncated = bad
    }

    if (hasKnowledge) confidence += 0.12;   // KB = much higher confidence
    if (hasContext) confidence += 0.05;
    if (hasPreviousTickets) confidence += 0.03;
    if (learningPrompt.length > 0) confidence += 0.04;

    // Response length sanity
    if (aiResponse.length < 80) {
      confidence -= 0.20;
    } else if (aiResponse.length < 150) {
      confidence -= 0.08;
    } else if (aiResponse.length > 200) {
      confidence += 0.03; // Substantive response
    }

    // Structural markers
    if (aiResponse.toLowerCase().includes('hej')) confidence += 0.02;
    if (aiResponse.toLowerCase().includes('hälsningar')) confidence += 0.02;

    // Uncertainty markers lower confidence (AI flagged it doesn't know)
    if (/undersöka|kontrollera|återkommer/i.test(aiResponse)) {
      confidence -= 0.08;
    }

    // If KB was available but response seems to ignore it (very short despite complex query)
    if (hasKnowledge && aiResponse.length < 200) {
      confidence -= 0.05;
    }

    return {
      response: aiResponse,
      confidence: Math.min(Math.max(confidence, 0.1), 0.99),
      knowledgeUsed: knowledgeItems.map(kb => kb.id),
    };
  } catch (error) {
    console.error('Error generating AI response:', error);
    throw error;
  }
}
