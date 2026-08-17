import { describe, expect, it, vi } from 'vitest';
import {
  adjudicate,
  deriveTags,
  questionTerms,
  scoreCandidate,
  selectCandidates,
  type CandidateCard,
} from '@/lib/services/knowledge-cards';

const card = (over: Partial<CandidateCard> & { id: string }): CandidateCard => ({
  question: '',
  answer: '',
  category: null,
  tags: [],
  ...over,
});

// Fake Anthropic client returning a canned tool_use block (or throwing).
const clientReturning = (content: unknown[]) =>
  ({ messages: { create: vi.fn().mockResolvedValue({ content }) } }) as never;

const clientThrowing = () =>
  ({ messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } }) as never;

describe('questionTerms', () => {
  it('drops stopwords, short words and punctuation', () => {
    expect(questionTerms('Hej! Hur kan jag säga upp mitt abonnemang?')).toEqual([
      'säga',
      'abonnemang',
    ]);
  });

  it('deduplicates repeated terms', () => {
    expect(questionTerms('faktura faktura FAKTURA')).toEqual(['faktura']);
  });
});

describe('scoreCandidate', () => {
  it('weights a question hit above an answer-only hit', () => {
    const terms = questionTerms('uppsägning av abonnemang');
    const inQuestion = scoreCandidate(
      card({ id: 'a', question: 'Hur gör jag en uppsägning?' }),
      terms
    );
    const inAnswer = scoreCandidate(
      card({ id: 'b', answer: 'En uppsägning görs skriftligt.' }),
      terms
    );
    expect(inQuestion).toBeGreaterThan(inAnswer);
  });

  it('scores zero when there are no usable terms', () => {
    expect(scoreCandidate(card({ id: 'a', question: 'Vad kostar det?' }), [])).toBe(0);
  });
});

describe('selectCandidates', () => {
  it('keeps only cards above the threshold, best first', () => {
    const cards = [
      card({ id: 'unrelated', question: 'Hur byter jag adress?' }),
      card({ id: 'exact', question: 'Hur säger jag upp mitt abonnemang?' }),
    ];
    const selected = selectCandidates(cards, 'Jag vill säga upp mitt abonnemang');
    expect(selected.map(c => c.id)).toEqual(['exact']);
  });

  it('returns nothing when the knowledge base is empty', () => {
    expect(selectCandidates([], 'vad som helst')).toEqual([]);
  });
});

describe('adjudicate', () => {
  const candidates = [card({ id: 'card-1', question: 'Vad kostar frakten?', answer: '49 kr.' })];

  it('short-circuits to "new" without calling the model when there are no candidates', async () => {
    const client = clientReturning([]);
    await expect(adjudicate('Fråga', 'Svar', [], { client })).resolves.toEqual({
      verdict: 'new',
      cardId: null,
      reason: '',
    });
    expect((client as never as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create)
      .not.toHaveBeenCalled();
  });

  it('returns a confirms verdict for a known card', async () => {
    const client = clientReturning([
      { type: 'tool_use', name: 'adjudicate_answer', input: { verdict: 'confirms', card_id: 'card-1' } },
    ]);
    await expect(adjudicate('Vad kostar frakten?', '49 kr.', candidates, { client })).resolves.toEqual({
      verdict: 'confirms',
      cardId: 'card-1',
      reason: '',
    });
  });

  it('carries the reason through on a contradiction', async () => {
    const client = clientReturning([
      {
        type: 'tool_use',
        name: 'adjudicate_answer',
        input: { verdict: 'contradicts', card_id: 'card-1', reason: 'Kortet säger 49 kr, svaret säger 79 kr.' },
      },
    ]);
    await expect(adjudicate('Vad kostar frakten?', '79 kr.', candidates, { client })).resolves.toEqual({
      verdict: 'contradicts',
      cardId: 'card-1',
      reason: 'Kortet säger 49 kr, svaret säger 79 kr.',
    });
  });

  it('falls back to "new" when the model names a card that was not offered', async () => {
    const client = clientReturning([
      { type: 'tool_use', name: 'adjudicate_answer', input: { verdict: 'contradicts', card_id: 'hallucinated' } },
    ]);
    await expect(adjudicate('Fråga', 'Svar', candidates, { client })).resolves.toEqual({
      verdict: 'new',
      cardId: null,
      reason: '',
    });
  });

  it('falls back to "new" when a verdict comes back without a card id', async () => {
    const client = clientReturning([
      { type: 'tool_use', name: 'adjudicate_answer', input: { verdict: 'confirms' } },
    ]);
    await expect(adjudicate('Fråga', 'Svar', candidates, { client })).resolves.toEqual({
      verdict: 'new',
      cardId: null,
      reason: '',
    });
  });

  it('falls back to "new" when no tool_use block comes back', async () => {
    const client = clientReturning([{ type: 'text', text: 'confirms' }]);
    await expect(adjudicate('Fråga', 'Svar', candidates, { client })).resolves.toEqual({
      verdict: 'new',
      cardId: null,
      reason: '',
    });
  });

  it('never throws when the model call fails', async () => {
    await expect(
      adjudicate('Fråga', 'Svar', candidates, { client: clientThrowing() })
    ).resolves.toEqual({ verdict: 'new', cardId: null, reason: '' });
  });
});

describe('deriveTags', () => {
  it('takes at most five meaningful terms from the subject', () => {
    expect(deriveTags('Hej jag undrar över fakturan och betalningen och leveransen och adressen också'))
      .toHaveLength(5);
  });
});
