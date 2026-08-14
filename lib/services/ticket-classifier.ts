import Anthropic from '@anthropic-ai/sdk';
import { product } from '@/lib/products';

// AI classification of a new ticket into the product's fixed category list
// (lib/products/*.ts ticketCategories) — the data behind the "vad kunderna
// frågar om" report panel. Same helper model and forced-tool-call pattern as
// the reranker in ai-generator.ts: the model MUST answer with one value from
// the enum, so there is nothing free-text to sanitise.
//
// NEVER throws (same contract as sendConfirmationEmail): classification is
// enrichment, not part of the sync path — any failure returns null and the
// ticket simply stays "Okategoriserat".

const HELPER_MODEL = 'claude-haiku-4-5';

// Classification reads the subject plus the start of the message — plenty
// for a topic call, and keeps the helper prompt small on long threads.
const MAX_MESSAGE_CHARS = 2000;

// Injection point for tests: a fake client and category list can be passed
// in; production callers use the module-level defaults.
export interface ClassifierDeps {
  client?: Pick<Anthropic, 'messages'>;
  categories?: string[];
}

let defaultClient: Anthropic | null = null;
function getDefaultClient(): Anthropic {
  if (!defaultClient) {
    defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return defaultClient;
}

export async function classifyTicket(
  subject: string,
  message: string,
  deps: ClassifierDeps = {}
): Promise<string | null> {
  const categories = deps.categories ?? product.ticketCategories;
  if (!categories || categories.length === 0) return null;

  try {
    const client = deps.client ?? getDefaultClient();
    const tool: Anthropic.Tool = {
      name: 'classify_ticket',
      description: 'Klassificera kundärendet i exakt en kategori.',
      input_schema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: categories,
            description: 'Den kategori som bäst beskriver vad kundens fråga handlar om.',
          },
        },
        required: ['category'],
      },
    };

    const result = await client.messages.create({
      model: HELPER_MODEL,
      max_tokens: 100,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'classify_ticket' },
      messages: [
        {
          role: 'user',
          content: `Klassificera detta kundtjänstärende.\n\nÄmne: ${subject}\n\nMeddelande:\n${message.slice(0, MAX_MESSAGE_CHARS)}`,
        },
      ],
    });

    const toolUse = result.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );
    const category = (toolUse?.input as { category?: unknown } | undefined)?.category;
    // Belt and braces: the enum should make this impossible, but a
    // hallucinated value must never reach the database.
    return typeof category === 'string' && categories.includes(category) ? category : null;
  } catch (error) {
    console.error('Ticket classification failed:', error);
    return null;
  }
}
