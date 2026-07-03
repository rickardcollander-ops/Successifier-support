import { describe, expect, it } from 'vitest';
import { parseTicketThread } from '@/lib/services/ticket-thread';

const ORIGINAL =
  '[Gmail Thread: thread-1]\n[Gmail ID: msg-1]\n[Inbox account: support@doldadress.se]\n[Message-Id: <a@b>]\n\nHej, jag vill säga upp mitt abonnemang.';

describe('lib/services/ticket-thread', () => {
  it('parses a single-message ticket as one customer entry without markers', () => {
    const thread = parseTicketThread(ORIGINAL);
    expect(thread).toHaveLength(1);
    expect(thread[0].role).toBe('customer');
    expect(thread[0].date).toBeNull();
    expect(thread[0].body).toBe('Hej, jag vill säga upp mitt abonnemang.');
  });

  it('parses follow-ups, support replies and internal comments in order', () => {
    const raw = [
      ORIGINAL,
      '[Support-svar 2026-06-30 14:22 av Anna]\nHej! Ditt abonnemang är nu uppsagt.',
      '[Intern kommentar 2026-06-30 14:25 av Anna]\nKollade i Billecta, faktura kvar.',
      '[Följdmail 2026-07-01 09:10]\n[Gmail ID: msg-2]\n[Inbox account: support@doldadress.se]\n\nTack! Men jag fick ändå en faktura, vad gäller?',
    ].join('\n\n---\n');

    const thread = parseTicketThread(raw);
    expect(thread.map(e => e.role)).toEqual(['customer', 'support', 'internal', 'customer']);
    expect(thread[1].date).toBe('2026-06-30 14:22');
    expect(thread[1].body).toBe('Hej! Ditt abonnemang är nu uppsagt.');
    expect(thread[2].body).toBe('Kollade i Billecta, faktura kvar.');
    expect(thread[3].date).toBe('2026-07-01 09:10');
    expect(thread[3].body).toBe('Tack! Men jag fick ändå en faktura, vad gäller?');
  });

  it('strips quoted history from customer follow-ups but keeps it in support replies', () => {
    const raw = [
      ORIGINAL,
      '[Följdmail 2026-07-01 09:10]\n\nJa tack, avsluta direkt.\n> Den 30 juni skrev support:\n> Vill du avsluta direkt?',
    ].join('\n\n---\n');

    const thread = parseTicketThread(raw);
    expect(thread[1].body).toBe('Ja tack, avsluta direkt.');
  });

  it('drops entries that only contain technical markers', () => {
    const raw = [ORIGINAL, '[Följdmail 2026-07-01 09:10]\n[Gmail ID: msg-2]\n'].join('\n\n---\n');
    const thread = parseTicketThread(raw);
    expect(thread).toHaveLength(1);
  });

  it('removes DrabbadHanterad markers embedded in the text', () => {
    const thread = parseTicketThread('Hej!\n[DrabbadHanterad: 2026-01-01]\nMvh Kund');
    expect(thread[0].body).toBe('Hej!\nMvh Kund');
  });
});
