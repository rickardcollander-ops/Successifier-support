import OpenAI from 'openai';
import { prisma } from '@/lib/db/client';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Knowledge Base Matching ---

// Synonyms and related terms for better matching
const KEYWORD_GROUPS: Record<string, string[]> = {
  uppsägning: ['säga upp', 'säger upp', 'avsluta', 'avslutar', 'stänga', 'cancel', 'cancellation', 'terminate', 'sluta', 'inte vill ha', 'vill inte ha', 'avslut', 'uppsäg'],
  faktura: ['invoice', 'räkning', 'betalning', 'betala', 'obetald', 'förfallen', 'förfaller', 'bill', 'belopp', 'fakturor', 'kreditfaktura', 'avgift'],
  abonnemang: ['prenumeration', 'subscription', 'plan', 'förnyelse', 'förnya', 'period', 'månadskostnad'],
  leverans: ['leverera', 'delivery', 'frakt', 'skicka', 'skickad', 'posta', 'brev', 'kivra', 'e-faktura', 'efaktura'],
  inloggning: ['logga in', 'login', 'lösenord', 'password', 'konto', 'mina sidor', 'account', 'glömt lösenord'],
  adress: ['address', 'adressändring', 'flytta', 'flytt', 'ny adress', 'ändra adress', 'byta adress'],
  betalning: ['swish', 'kort', 'card', 'autogiro', 'bankgiro', 'betalt', 'betalat', 'payment'],
  reklamation: ['klaga', 'complaint', 'missnöjd', 'fel', 'problem', 'fungerar inte', 'trasig', 'skadat'],
};

function expandKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const expanded: string[] = [];
  for (const [_group, synonyms] of Object.entries(KEYWORD_GROUPS)) {
    if (synonyms.some(syn => lower.includes(syn))) {
      expanded.push(...synonyms);
    }
  }
  return expanded;
}

async function findRelevantKnowledge(tenantId: string, message: string): Promise<string> {
  try {
    const knowledgeBase = await prisma.knowledgeBase.findMany({
      where: { tenantId, isActive: true },
    });

    if (knowledgeBase.length === 0) return '';

    const messageLower = message.toLowerCase();
    const words = messageLower.split(/\s+/).filter((w) => w.length > 2);
    const expandedTerms = expandKeywords(messageLower);

    const relevant = knowledgeBase
      .map((kb) => {
        const titleLower = kb.title.toLowerCase();
        const contentLower = kb.content.toLowerCase();

        let score = 0;

        // Direct title match (highest priority)
        if (messageLower.includes(titleLower) || titleLower.includes(messageLower.substring(0, 60))) score += 15;

        // Word-level title matching
        const titleMatchCount = words.filter(w => titleLower.includes(w)).length;
        score += titleMatchCount * 3;

        // Content matching
        const contentMatchCount = words.filter(w => contentLower.includes(w)).length;
        score += Math.min(contentMatchCount * 1.5, 10);

        // Tag matching
        const tagMatches = kb.tags.filter(tag =>
          messageLower.includes(tag.toLowerCase()) ||
          words.some(w => tag.toLowerCase().includes(w))
        ).length;
        score += tagMatches * 4;

        // Expanded keyword/synonym matching
        if (expandedTerms.length > 0) {
          const expandedTitleMatches = expandedTerms.filter(t => titleLower.includes(t)).length;
          const expandedContentMatches = expandedTerms.filter(t => contentLower.includes(t)).length;
          score += expandedTitleMatches * 5;
          score += Math.min(expandedContentMatches * 2, 8);
        }

        // Category matching
        if (kb.category) {
          const catLower = kb.category.toLowerCase();
          if (words.some(w => catLower.includes(w))) score += 3;
          if (expandedTerms.some(t => catLower.includes(t))) score += 3;
        }

        // Penalize auto-generated learning articles slightly so manual KB takes priority
        if (kb.category === 'Lärande från skickade svar') {
          score *= 0.7;
        }

        return { kb, score };
      })
      .filter(({ score }) => score > 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ kb }) => kb);

    if (relevant.length === 0) return '';

    let formatted = '\n\n=== KUNSKAPSBAS (VIKTIGT: Använd denna information för att ge korrekta svar) ===\n';
    relevant.forEach((kb) => {
      formatted += `\n--- ${kb.title} ${kb.category ? `[${kb.category}]` : ''} ---\n`;
      formatted += `${kb.content}\n`;
    });

    return formatted;
  } catch (error) {
    console.error('Error fetching knowledge base:', error);
    return '';
  }
}

// --- Learning Examples ---

async function findLearningExamples(tenantId: string, message: string): Promise<string> {
  try {
    const messageLower = message.toLowerCase();
    const searchTerms = messageLower
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5);

    if (searchTerms.length === 0) return '';

    // Get recent positive feedback - try multiple search strategies
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
      },
    });

    if (feedback.length === 0) return '';

    // Score by relevance
    const scored = feedback
      .map(fb => {
        const fbText = `${fb.subject} ${fb.originalMessage}`.toLowerCase();
        const matchCount = searchTerms.filter(t => fbText.includes(t)).length;
        return { fb, score: matchCount };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (scored.length === 0) return '';

    let formatted = '\n\n=== EXEMPEL PÅ GODKÄNDA SVAR (Använd liknande ton och format) ===\n';
    scored.forEach(({ fb }, index) => {
      formatted += `\nExempel ${index + 1}:\n`;
      formatted += `Kundens ämne: ${fb.subject}\n`;
      formatted += `Kund skrev: ${fb.originalMessage.substring(0, 250)}\n`;
      formatted += `Godkänt svar: ${fb.finalResponse?.substring(0, 400) || 'N/A'}\n`;
    });

    return formatted;
  } catch (error) {
    console.error('Error fetching learning examples:', error);
    return '';
  }
}

// --- Context Formatting (ALL integrations) ---

function formatContextForPrompt(contextData: any): string {
  if (!contextData) return '';

  let formatted = '\n\n=== KUNDINFORMATION FRÅN SYSTEM ===\n';
  let hasData = false;

  // Stripe context
  if (contextData.stripe) {
    hasData = true;
    formatted += '\n--- Stripe (Prenumerationer & Betalningar) ---\n';
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
      formatted += `Obetalda Stripe-fakturor: ${unpaidStripe.length}\n`;
      unpaidStripe.forEach((inv: any) => {
        formatted += `  - ${inv.id}: ${inv.amount ? (inv.amount / 100).toFixed(0) + ' kr' : '?'}, förfaller ${inv.dueDate ? new Date(inv.dueDate * 1000).toLocaleDateString('sv-SE') : 'okänt'}\n`;
      });
    }

    const charges = contextData.stripe.charges || [];
    if (charges.length > 0) {
      formatted += `Senaste betalningar: ${charges.slice(0, 3).map((c: any) => `${c.amount ? (c.amount / 100).toFixed(0) + ' kr' : '?'} (${c.status})`).join(', ')}\n`;
    }
  }

  // Billecta context
  if (contextData.billecta) {
    hasData = true;
    const b = contextData.billecta;
    formatted += '\n--- Billecta (Fakturering) ---\n';
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

  // Gmail email history
  if (contextData.gmail) {
    hasData = true;
    formatted += `\n--- Gmail ---\nTotala mailkonversationer med kunden: ${contextData.gmail.totalEmails || 0}\n`;
  }

  // Resend email history
  if (contextData.resend) {
    hasData = true;
    formatted += `\n--- E-posthistorik ---\nAntal skickade mail: ${contextData.resend.emailsSent || 0}\n`;
  }

  if (!hasData) return '';

  return formatted;
}

// --- Previous Ticket History ---

async function findPreviousTicketContext(tenantId: string, customerEmail: string, currentTicketId?: string): Promise<string> {
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

    let formatted = '\n\n=== KUNDENS TIDIGARE ÄRENDEN (Använd för att ge sammanhängande support) ===\n';
    previousTickets.forEach((t, idx) => {
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
  customerEmail?: string
): Promise<{ response: string; confidence: number }> {
  try {
    const fullQuery = `${subject} ${originalMessage}`;

    const [contextPrompt, knowledgePrompt, learningPrompt, previousTicketsPrompt] = await Promise.all([
      Promise.resolve(formatContextForPrompt(contextData)),
      tenantId ? findRelevantKnowledge(tenantId, fullQuery) : Promise.resolve(''),
      tenantId ? findLearningExamples(tenantId, fullQuery) : Promise.resolve(''),
      (tenantId && customerEmail) ? findPreviousTicketContext(tenantId, customerEmail, ticketId) : Promise.resolve(''),
    ]);

    const hasKnowledge = knowledgePrompt.length > 0;
    const hasContext = contextPrompt.length > 0;
    const hasPreviousTickets = previousTicketsPrompt.length > 0;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Du är en professionell, vänlig och hjälpsam kundtjänstmedarbetare för Doldadress.

DITT UPPDRAG:
Ge korrekta, empatiska och effektiva svar som löser kundens problem. Anpassa ton och längd efter ärendet.

REGLER (MÅSTE FÖLJAS):

1. **SPRÅK**: Svara på SAMMA SPRÅK som kundens meddelande. Svenska om de skriver svenska, engelska om engelska, etc.

2. **KUNSKAPSBAS = SANNING**: Om kunskapsbasartiklar medföljer nedan:
   - Använd ALLTID informationen därifrån som grund
   - HITTA INTE PÅ information som inte finns i kunskapsbasen
   - Följ instruktioner och steg exakt som de beskrivs
   - Om kunskapsbasen nämner "Mina sidor" eller specifika URL:er - inkludera dem

3. **KUNDDATA**: Om faktura/prenumerationsdata medföljer:
   - Referera till specifika fakturanummer, belopp, datum när relevant
   - Om kunden har obetalda fakturor OCH frågar om betalning - nämn det diplomatiskt
   - Om kontot är avslutat - bekräfta det med datum om tillgängligt
   - Nämn ALDRIG Stripe/Billecta/systemnamn till kunden - säg bara "vårt system" eller "våra register"

4. **TIDIGARE ÄRENDEN**: Om kundens historik medföljer:
   - Referera till tidigare konversationer om relevant ("Jag ser att du tidigare kontaktat oss om...")
   - Undvik att upprepa samma information som redan givits
   - Bygg vidare på tidigare svar

5. **TON OCH FORMAT**:
   - Professionell men varm och personlig
   - Börja med hälsning ("Hej [namn]," om namn finns, annars "Hej,")
   - Var direkt - ge svaret tidigt, inte efter lång inledning
   - Använd punktlistor för instruktioner med flera steg
   - Avsluta med "Hör av dig om du har fler frågor!" eller liknande
   - Signera med "Vänliga hälsningar,\\nDoldadress Kundtjänst"
   - Anpassa svarets längd: korta frågor = kort svar, komplexa = utförligare

6. **OSÄKERHET**: Om du INTE har tillräcklig information:
   - Säg "Jag ska undersöka detta närmare och återkommer" istället för att gissa
   - Ange vilken information du behöver från kunden

7. **FÖRBJUDET**:
   - Hitta ALDRIG på policys, priser eller villkor
   - Lova ALDRIG saker du inte kan bekräfta (t.ex. specifika leveransdatum)
   - Avslöja ALDRIG intern systeminformation`,
        },
        {
          role: 'user',
          content: `Ämne: ${subject}\n\nKundens meddelande:\n${originalMessage}${contextPrompt}${previousTicketsPrompt}${knowledgePrompt}${learningPrompt}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 1200,
    });

    const aiResponse = completion.choices[0].message.content || '';

    // Confidence scoring
    let confidence = 0.70;

    // Model completion quality
    if (completion.choices[0].finish_reason === 'stop') {
      confidence += 0.10;
    } else if (completion.choices[0].finish_reason === 'length') {
      confidence -= 0.15; // Cut off = bad
    }

    // Knowledge base available = higher confidence
    if (hasKnowledge) confidence += 0.10;

    // Context data available = slightly higher confidence
    if (hasContext) confidence += 0.05;

    // Previous tickets give better context
    if (hasPreviousTickets) confidence += 0.03;

    // Learning examples available
    if (learningPrompt.length > 0) confidence += 0.05;

    // Response quality checks
    if (aiResponse.length < 50) {
      confidence -= 0.15; // Way too short
    } else if (aiResponse.length < 100) {
      confidence -= 0.08;
    }

    // Proper structure indicators
    if (aiResponse.includes('Hej') || aiResponse.includes('hej')) confidence += 0.02;
    if (aiResponse.includes('hälsningar') || aiResponse.includes('Hälsningar')) confidence += 0.02;

    // Uncertainty indicators lower confidence
    if (aiResponse.includes('undersöka detta') || aiResponse.includes('återkommer')) {
      confidence -= 0.10;
    }

    return {
      response: aiResponse,
      confidence: Math.min(Math.max(confidence, 0.1), 0.99),
    };
  } catch (error) {
    console.error('Error generating AI response:', error);
    throw error;
  }
}
