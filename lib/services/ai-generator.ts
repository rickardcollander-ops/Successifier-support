import OpenAI from 'openai';
import { prisma } from '@/lib/db/client';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function findRelevantKnowledge(tenantId: string, message: string): Promise<string> {
  try {
    const knowledgeBase = await prisma.knowledgeBase.findMany({
      where: { tenantId, isActive: true },
    });

    if (knowledgeBase.length === 0) return '';

    const messageLower = message.toLowerCase();
    const words = messageLower.split(/\s+/).filter((w) => w.length > 3);

    // Enhanced keyword matching for common topics
    const cancellationKeywords = ['säger upp', 'uppsägning', 'avsluta', 'säga upp', 'säger upp', 'avslutar'];
    const isCancellationQuery = cancellationKeywords.some(kw => messageLower.includes(kw));

    const relevant = knowledgeBase
      .map((kb) => {
        const titleLower = kb.title.toLowerCase();
        const contentLower = kb.content.toLowerCase();

        let score = 0;

        // Title matching (highest priority)
        if (messageLower.includes(titleLower)) score += 10;
        if (words.some((w) => titleLower.includes(w))) score += 5;

        // Content matching
        if (words.some((w) => contentLower.includes(w))) score += 2;

        // Tag matching
        if (kb.tags.some((tag) =>
          messageLower.includes(tag.toLowerCase()) ||
          words.some((w) => tag.toLowerCase().includes(w))
        )) score += 3;

        // Boost cancellation-related articles if query is about cancellation
        if (isCancellationQuery && (
          titleLower.includes('uppsägning') ||
          titleLower.includes('abonnemang') ||
          contentLower.includes('säger upp')
        )) score += 15;

        return { kb, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ kb }) => kb);

    if (relevant.length === 0) return '';

    let formatted = '\n\n=== KUNSKAPSBAS (VIKTIGT: Använd denna information för att ge korrekta svar) ===\n';
    relevant.forEach((kb) => {
      formatted += `\n--- ${kb.title} ${kb.category ? `(${kb.category})` : ''} ---\n`;
      formatted += `${kb.content}\n`;
    });

    return formatted;
  } catch (error) {
    console.error('Error fetching knowledge base:', error);
    return '';
  }
}

async function findLearningExamples(tenantId: string, message: string): Promise<string> {
  try {
    const messageLower = message.toLowerCase();
    
    // Get recent positive feedback for similar queries
    const feedback = await prisma.aIResponseFeedback.findMany({
      where: {
        tenantId,
        rating: 'positive',
        OR: [
          { subject: { contains: messageLower.substring(0, 50), mode: 'insensitive' } },
          { originalMessage: { contains: messageLower.substring(0, 50), mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        originalMessage: true,
        finalResponse: true,
      },
    });

    if (feedback.length === 0) return '';

    let formatted = '\n\n=== EXEMPEL PÅ BRA SVAR (Lär från dessa) ===\n';
    feedback.forEach((fb, index) => {
      formatted += `\nExempel ${index + 1}:\n`;
      formatted += `Kund frågade: ${fb.originalMessage.substring(0, 200)}...\n`;
      formatted += `Bra svar: ${fb.finalResponse?.substring(0, 300) || 'N/A'}...\n`;
    });

    return formatted;
  } catch (error) {
    console.error('Error fetching learning examples:', error);
    return '';
  }
}

function formatContextForPrompt(contextData: any): string {
  if (!contextData) return '';

  let formatted = '\n\n=== Kundhistorik från Billecta ===\n';

  const billecta = contextData.billecta;
  if (billecta) {
    if (billecta.debtorName) formatted += `Kundnamn: ${billecta.debtorName}\n`;
    if (billecta.debtorOrgNo) formatted += `Org/personnr: ${billecta.debtorOrgNo}\n`;

    const invoices = billecta.invoices || [];
    formatted += `Totalt antal fakturor: ${invoices.length}\n`;

    const unpaid = invoices.filter((inv: any) => !inv.isPaid);
    const paid = invoices.filter((inv: any) => inv.isPaid);

    if (unpaid.length > 0) {
      formatted += `\nObetalda fakturor (${unpaid.length}):\n`;
      unpaid.forEach((inv: any) => {
        formatted += `  - Faktura #${inv.number || inv.id}: ${inv.amount ?? '?'} kr, förfaller ${inv.dueDate || 'okänt'}, status: ${inv.status || 'okänd'}${inv.deliveryMethod ? `, leverans: ${inv.deliveryMethod}` : ''}\n`;
      });
    }

    if (paid.length > 0) {
      formatted += `\nBetalda fakturor (${paid.length}):\n`;
      paid.slice(0, 5).forEach((inv: any) => {
        formatted += `  - Faktura #${inv.number || inv.id}: ${inv.amount ?? '?'} kr, status: ${inv.status || 'betald'}${inv.deliveryMethod ? `, leverans: ${inv.deliveryMethod}` : ''}\n`;
      });
      if (paid.length > 5) formatted += `  ... och ${paid.length - 5} till\n`;
    }
  }

  if (!billecta) {
    formatted += 'Ingen fakturainformation hittades för denna kund.\n';
  }

  return formatted;
}

export async function generateAIResponse(
  subject: string,
  originalMessage: string,
  contextData?: any,
  tenantId?: string
): Promise<{ response: string; confidence: number }> {
  try {
    const contextPrompt = formatContextForPrompt(contextData);

    const knowledgePrompt = tenantId
      ? await findRelevantKnowledge(tenantId, `${subject} ${originalMessage}`)
      : '';

    const learningPrompt = tenantId
      ? await findLearningExamples(tenantId, `${subject} ${originalMessage}`)
      : '';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `Du är en professionell kundtjänstmedarbetare för Doldadress. 

KRITISKA REGLER (MÅSTE FÖLJAS):
1. **SPRÅK**: Detektera vilket språk kundens meddelande är skrivet på och svara på SAMMA SPRÅK. Om meddelandet är på engelska, svara på engelska. Om det är på svenska, svara på svenska.

2. **KUNSKAPSBAS HAR ABSOLUT PRIORITET** - Om det finns en kunskapsbasartikel som matchar kundens fråga:
   - ANVÄND EXAKT den informationen från kunskapsbasen
   - KOPIERA instruktioner och steg från kunskapsbasen
   - GISSA ALDRIG eller hitta på information om kunskapsbasen har svaret
   - Detta gäller SÄRSKILT för uppsägning/avsluta/säga upp abonnemang

3. **UPPSÄGNING/AVSLUTA ABONNEMANG** - Om kunden frågar om detta:
   - ANVÄND ENDAST informationen från kunskapsbasen om "Uppsägning"
   - Följ EXAKT de steg som står i kunskapsbasen
   - Nämn att kunden kan göra det själv via Mina sidor > Prenumeration
   - Erbjud manuell hjälp om kunden vill
   - Förklara att uppsägning gäller till nästa förnyelseperiod
   - Om kunden frågar om faktura efter uppsägning: förklara att redan skapade fakturor avser aktiv period

4. Analysera kundens ärende noggrant - förstå vad de verkligen frågar om

5. Om det finns fakturahistorik från Billecta, använd den för att komplettera svaret (t.ex. referera till specifika fakturanummer, belopp, förfallodatum)

6. Om kunden har obetalda fakturor OCH frågar om betalning, nämn det vänligt

7. Avsluta alltid med att erbjuda ytterligare hjälp

ABSOLUT FÖRBUD: Ge ALDRIG information om uppsägning som INTE finns i kunskapsbasen. Om kunskapsbasen säger "Mina sidor > Prenumeration", säg EXAKT det - inte något annat.`,
        },
        {
          role: 'user',
          content: `Ämne: ${subject}\n\nMeddelande: ${originalMessage}${contextPrompt}${knowledgePrompt}${learningPrompt}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const aiResponse = completion.choices[0].message.content || '';
    
    // Calculate confidence based on finish_reason and response quality
    let confidence = 0.85; // Base confidence
    
    if (completion.choices[0].finish_reason === 'stop') {
      confidence = 0.95; // High confidence if completed naturally
    } else if (completion.choices[0].finish_reason === 'length') {
      confidence = 0.75; // Lower confidence if cut off
    }
    
    // Adjust based on response quality indicators
    if (aiResponse.length < 100) {
      confidence -= 0.1; // Too short
    }
    if (aiResponse.includes('Hej') && aiResponse.includes('Vänliga hälsningar')) {
      confidence += 0.05; // Proper greeting and closing
    }

    return {
      response: aiResponse,
      confidence: Math.min(Math.max(confidence, 0), 1), // Clamp between 0-1
    };
  } catch (error) {
    console.error('Error generating AI response:', error);
    throw error;
  }
}
