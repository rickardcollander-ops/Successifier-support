import { describe, expect, it, vi } from 'vitest';
import { classifyTicket } from '@/lib/services/ticket-classifier';

const CATEGORIES = ['uppsägning', 'faktura & betalning', 'övrigt'];

// Fake Anthropic client returning a canned tool_use block (or throwing).
const clientReturning = (content: unknown[]) =>
  ({ messages: { create: vi.fn().mockResolvedValue({ content }) } }) as never;

describe('classifyTicket', () => {
  it('returns the category from the forced tool call', async () => {
    const client = clientReturning([
      { type: 'tool_use', name: 'classify_ticket', input: { category: 'uppsägning' } },
    ]);
    await expect(
      classifyTicket('Vill säga upp', 'Jag vill avsluta min tjänst', { client, categories: CATEGORIES })
    ).resolves.toBe('uppsägning');
  });

  it('rejects a hallucinated category outside the list', async () => {
    const client = clientReturning([
      { type: 'tool_use', name: 'classify_ticket', input: { category: 'påhittad' } },
    ]);
    await expect(
      classifyTicket('Ämne', 'Text', { client, categories: CATEGORIES })
    ).resolves.toBeNull();
  });

  it('returns null when no tool_use block comes back', async () => {
    const client = clientReturning([{ type: 'text', text: 'uppsägning' }]);
    await expect(
      classifyTicket('Ämne', 'Text', { client, categories: CATEGORIES })
    ).resolves.toBeNull();
  });

  it('never throws on API errors', async () => {
    const client = {
      messages: { create: vi.fn().mockRejectedValue(new Error('rate limited')) },
    } as never;
    await expect(
      classifyTicket('Ämne', 'Text', { client, categories: CATEGORIES })
    ).resolves.toBeNull();
  });

  it('returns null without a category list instead of calling the API', async () => {
    const create = vi.fn();
    const client = { messages: { create } } as never;
    await expect(classifyTicket('Ämne', 'Text', { client, categories: [] })).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
