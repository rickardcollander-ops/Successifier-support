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

    const systemPrompt = `Du är en professionell kundsupportagent för Doldadress. Ditt mål är att ge korrekta, professionella och empatiska svar på svenska.

VIKTIGT - KUNSKAPSBAS (KOLLA ALLTID FÖRST):
${relevantKnowledge.length > 0 ? relevantKnowledge.map(kb => `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${kb.title}
Kategori: ${kb.category || 'Allmänt'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${kb.content}
`).join('\n') : 'Ingen relevant kunskapsbas hittades för denna fråga.'}

KUNDKONTEXT:
${contextFormatted}

INSTRUKTIONER:
1. **BÖRJA ALLTID** med att söka svar i kunskapsbasen ovan
2. Om kunskapsbasen har information - använd den som grund för ditt svar
3. Komplettera med kundspecifik data (fakturor, abonnemang etc) när relevant
4. Var professionell men vänlig på svenska
5. Om du inte har tillräcklig information - fråga förtydligande frågor
6. Håll svar koncisa men kompletta
7. Referera aldrig till känslig kundinformation i klartext
8. Om kunskapsbasen innehåller länkar eller systemreferenser - inkludera dessa i svaret`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: customerMessage },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      return completion.choices[0]?.message?.content || 'I apologize, but I was unable to generate a response. Please try again.';
    } catch (error) {
      console.error('Error generating AI response:', error);
      throw error;
    }
  }

  private findRelevantKnowledge(message: string, knowledgeBase: KnowledgeBase[]): KnowledgeBase[] {
    const messageLower = message.toLowerCase();
    
    return knowledgeBase
      .filter(kb => kb.isActive)
      .filter(kb => {
        const titleMatch = kb.title.toLowerCase().includes(messageLower) || 
                          messageLower.includes(kb.title.toLowerCase());
        const contentMatch = kb.content.toLowerCase().includes(messageLower) ||
                            messageLower.includes(kb.content.toLowerCase().substring(0, 100));
        const tagMatch = kb.tags.some(tag => 
          messageLower.includes(tag.toLowerCase()) || 
          tag.toLowerCase().includes(messageLower)
        );
        
        return titleMatch || contentMatch || tagMatch;
      })
      .slice(0, 5);
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
