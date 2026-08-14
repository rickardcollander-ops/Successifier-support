import { describe, it, expect } from 'vitest';
import {
  dedupeByTicket,
  selectLearningExamples,
  formatLearningExamples,
  type LearningFeedbackRow,
} from '@/lib/services/learning-examples';

const base = (over: Partial<LearningFeedbackRow>): LearningFeedbackRow => ({
  ticketId: 't1',
  subject: 'Uppsägning av abonnemang',
  originalMessage: 'Hej, jag vill säga upp mitt abonnemang hos er.',
  aiResponse: 'Hej! Ditt abonnemang är nu uppsagt och avslutas vid periodens slut.',
  finalResponse: 'Hej! Ditt abonnemang är nu uppsagt och avslutas vid periodens slut.',
  wasEdited: false,
  rating: null,
  ...over,
});

const TERMS = ['uppsägning', 'abonnemang'];

describe('dedupeByTicket', () => {
  it('keeps the newest row per ticket', () => {
    const rows = [
      base({ ticketId: 'a', finalResponse: 'nyaste' }),
      base({ ticketId: 'a', finalResponse: 'äldre' }),
      base({ ticketId: 'b' }),
    ];
    const out = dedupeByTicket(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.ticketId === 'a')?.finalResponse).toBe('nyaste');
  });

  it('carries an explicit rating from an older row onto the newest unrated row', () => {
    // Thumbs-down while composing, then the automatic unrated row at send —
    // the negative signal must survive.
    const rows = [
      base({ ticketId: 'a', rating: null }),
      base({ ticketId: 'a', rating: 'negative' }),
    ];
    const out = dedupeByTicket(rows);
    expect(out).toHaveLength(1);
    expect(out[0].rating).toBe('negative');
  });

  it('does not overwrite a rating on the newest row', () => {
    const rows = [
      base({ ticketId: 'a', rating: 'positive' }),
      base({ ticketId: 'a', rating: 'negative' }),
    ];
    expect(dedupeByTicket(rows)[0].rating).toBe('positive');
  });
});

describe('selectLearningExamples', () => {
  it('treats unrated verbatim sends as exemplars (rating not required)', () => {
    const { exemplars, correctives } = selectLearningExamples(
      [base({ wasEdited: false, rating: null })],
      TERMS
    );
    expect(exemplars).toHaveLength(1);
    expect(exemplars[0].verbatim).toBe(true);
    expect(correctives).toHaveLength(0);
  });

  it('turns a rewritten draft into a corrective pair', () => {
    const row = base({
      wasEdited: true,
      aiResponse: 'Tyvärr kan vi inte hjälpa dig med detta ärende just nu.',
      finalResponse:
        'Hej! Jag har nu avslutat ditt abonnemang. Den obetalda fakturan krediteras och kan bortses från.',
    });
    const { exemplars, correctives } = selectLearningExamples([row], TERMS);
    expect(correctives).toHaveLength(1);
    expect(exemplars).toHaveLength(0);
  });

  it('treats a lightly edited draft as an exemplar of the sent version', () => {
    const row = base({
      wasEdited: true,
      aiResponse: 'Hej! Ditt abonnemang är nu uppsagt och avslutas vid periodens slut.',
      finalResponse: 'Hej! Ditt abonnemang är nu uppsagt och avslutas vid nuvarande periodens slut.',
    });
    const { exemplars, correctives } = selectLearningExamples([row], TERMS);
    expect(exemplars).toHaveLength(1);
    expect(exemplars[0].verbatim).toBe(false);
    expect(correctives).toHaveLength(0);
  });

  it('always treats negative-rated rows as correctives, even if barely edited', () => {
    const row = base({ wasEdited: true, rating: 'negative' });
    const { exemplars, correctives } = selectLearningExamples([row], TERMS);
    expect(correctives).toHaveLength(1);
    expect(exemplars).toHaveLength(0);
  });

  it('never turns a positive-rated edit into a corrective', () => {
    const row = base({
      wasEdited: true,
      rating: 'positive',
      aiResponse: 'Något helt annat innehåll som inte alls liknar svaret.',
      finalResponse: 'Hej! Ditt abonnemang är nu uppsagt.',
    });
    const { exemplars, correctives } = selectLearningExamples([row], TERMS);
    expect(exemplars).toHaveLength(1);
    expect(correctives).toHaveLength(0);
  });

  it('skips rows that do not match any search term', () => {
    const { exemplars, correctives } = selectLearningExamples(
      [base({ subject: 'Leveransfråga', originalMessage: 'När kommer brevet?' })],
      TERMS
    );
    expect(exemplars).toHaveLength(0);
    expect(correctives).toHaveLength(0);
  });

  it('skips rows without a final response and caps list sizes', () => {
    const rows: LearningFeedbackRow[] = [
      base({ ticketId: 'x', finalResponse: null }),
      ...Array.from({ length: 6 }, (_, i) => base({ ticketId: `e${i}` })),
    ];
    const { exemplars } = selectLearningExamples(rows, TERMS);
    expect(exemplars).toHaveLength(3);
  });

  it('ranks positive-rated exemplars above unrated ones', () => {
    const rows = [
      base({ ticketId: 'unrated' }),
      base({ ticketId: 'rated', rating: 'positive' }),
    ];
    const { exemplars } = selectLearningExamples(rows, TERMS);
    expect(exemplars[0].row.ticketId).toBe('rated');
  });
});

describe('formatLearningExamples', () => {
  it('returns empty string when there is nothing to show', () => {
    expect(formatLearningExamples({ exemplars: [], correctives: [] })).toBe('');
  });

  it('includes correctives even when there are no exemplars', () => {
    // The old implementation early-returned before the anti-example section
    // when no positive exemplar matched — the rewrite signal was lost.
    const row = base({
      wasEdited: true,
      aiResponse: 'Fel svar.',
      finalResponse: 'Rätt svar som agenten skickade.',
    });
    const out = formatLearningExamples({ exemplars: [], correctives: [{ row }] });
    expect(out).toContain('UNDVIK');
    expect(out).toContain('Fel svar.');
    expect(out).toContain('Rätt svar som agenten skickade.');
    expect(out).not.toContain('GODKÄNDA EXEMPELSVAR');
  });

  it('strips Gmail sync metadata from the customer excerpt', () => {
    const row = base({
      originalMessage: '[Gmail ID: abc123]\n[Message-Id: <x@y>]\n\nHej, jag vill säga upp.',
    });
    const out = formatLearningExamples({ exemplars: [{ row, verbatim: true }], correctives: [] });
    expect(out).not.toContain('Gmail ID');
    expect(out).not.toContain('Message-Id');
    expect(out).toContain('Hej, jag vill säga upp.');
  });

  it('only shows the customer question, not later thread segments', () => {
    const row = base({
      originalMessage: 'Ursprunglig fråga.\n---\n[Support-svar 2026-01-01]\nVårt tidigare svar.',
    });
    const out = formatLearningExamples({ exemplars: [{ row, verbatim: true }], correctives: [] });
    expect(out).toContain('Ursprunglig fråga.');
    expect(out).not.toContain('Vårt tidigare svar.');
  });
});
