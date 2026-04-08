import OpenAI from 'openai';
import type { KnowledgeBase, TicketContext } from '../types';

export class AIService {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async generateResponse(
    customerMessage: string,
    context: TicketContext,
    contextFormatted: string,
    knowledgeBase: KnowledgeBase[]
  ): Promise<string> {
    const relevantKnowledge = this.findRelevantKnowledge(customerMessage, knowledgeBase);

    const systemPrompt = `Du är en professionell, vänlig och hjälpsam kundtjänstmedarbetare för Doldadress.

KUNSKAPSBAS (KOLLA ALLTID FÖRST - detta är verifierad information):
${relevantKnowledge.length > 0 ? relevantKnowledge.map(kb => `
--- ${kb.title} ${kb.category ? `[${kb.category}]` : ''} ---
${kb.content}
`).join('\n') : 'Ingen specifik kunskapsbasartikel matchar denna fråga.'}

KUNDDATA FRÅN SYSTEM:
${contextFormatted || 'Ingen kunddata tillgänglig.'}

INSTRUKTIONER:
1. **KUNSKAPSBAS = SANNING** - Använd ALLTID kunskapsbasen som grund. Hitta inte på information.
2. Komplettera med kundspecifik data (fakturor, prenumerationer) när relevant
3. Svara på SAMMA SPRÅK som kunden
4. Var professionell men varm och personlig
5. Börja med hälsning, ge svaret direkt, avsluta med erbjudande om mer hjälp
6. Signera: "Vänliga hälsningar,\\nDoldadress Kundtjänst"
7. Om du saknar information - säg att du ska undersöka det, gissa INTE
8. Nämn ALDRIG systemnamn (Stripe, Billecta) - säg "vårt system" eller "våra register"
9. Anpassa svarets längd: korta frågor = kort svar, komplexa = utförligare`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: customerMessage },
        ],
        temperature: 0.5,
        max_tokens: 1200,
      });

      return completion.choices[0]?.message?.content || 'Tyvärr kunde jag inte generera ett svar. Försök igen.';
    } catch (error) {
      console.error('Error generating AI response:', error);
      throw error;
    }
  }

  private findRelevantKnowledge(message: string, knowledgeBase: KnowledgeBase[]): KnowledgeBase[] {
    const messageLower = message.toLowerCase();
    const words = messageLower.split(/\s+/).filter(w => w.length > 2);

    // Keyword groups for synonym matching
    const keywordGroups: Record<string, string[]> = {
      uppsägning: ['säga upp', 'säger upp', 'avsluta', 'avslutar', 'stänga', 'cancel', 'sluta', 'uppsäg'],
      faktura: ['invoice', 'räkning', 'betalning', 'betala', 'obetald', 'förfallen', 'bill', 'fakturor', 'avgift'],
      abonnemang: ['prenumeration', 'subscription', 'plan', 'förnyelse', 'månadskostnad'],
      leverans: ['leverera', 'delivery', 'frakt', 'skicka', 'kivra', 'e-faktura'],
      inloggning: ['logga in', 'login', 'lösenord', 'password', 'konto', 'mina sidor'],
      adress: ['adressändring', 'flytta', 'flytt', 'ny adress', 'ändra adress'],
    };

    const expandedTerms: string[] = [];
    for (const synonyms of Object.values(keywordGroups)) {
      if (synonyms.some(syn => messageLower.includes(syn))) {
        expandedTerms.push(...synonyms);
      }
    }

    return knowledgeBase
      .filter(kb => kb.isActive)
      .map(kb => {
        const titleLower = kb.title.toLowerCase();
        const contentLower = kb.content.toLowerCase();
        let score = 0;

        // Title matching
        if (messageLower.includes(titleLower)) score += 15;
        score += words.filter(w => titleLower.includes(w)).length * 3;

        // Content matching
        score += Math.min(words.filter(w => contentLower.includes(w)).length * 1.5, 10);

        // Tag matching
        score += kb.tags.filter(tag =>
          messageLower.includes(tag.toLowerCase()) ||
          words.some(w => tag.toLowerCase().includes(w))
        ).length * 4;

        // Expanded synonym matching
        if (expandedTerms.length > 0) {
          score += expandedTerms.filter(t => titleLower.includes(t)).length * 5;
          score += Math.min(expandedTerms.filter(t => contentLower.includes(t)).length * 2, 8);
        }

        // Penalize auto-generated articles
        if (kb.category === 'Lärande från skickade svar') {
          score *= 0.7;
        }

        return { kb, score };
      })
      .filter(({ score }) => score > 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ kb }) => kb);
  }

  async embedText(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('Error creating embedding:', error);
      throw error;
    }
  }
}
