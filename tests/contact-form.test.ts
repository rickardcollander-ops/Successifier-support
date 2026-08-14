import { describe, expect, it } from 'vitest';
import {
  FALLBACK_SUBJECT,
  buildContactTicketMessage,
  deriveSubject,
  isValidContactEmail,
} from '@/lib/services/contact-form';

describe('isValidContactEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidContactEmail('kund@example.com')).toBe(true);
    expect(isValidContactEmail('anna.svensson+dold@gmail.com')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidContactEmail('')).toBe(false);
    expect(isValidContactEmail('inte en mejladress')).toBe(false);
    expect(isValidContactEmail('kund@')).toBe(false);
    expect(isValidContactEmail('@example.com')).toBe(false);
    expect(isValidContactEmail('kund@example')).toBe(false);
    expect(isValidContactEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('deriveSubject', () => {
  it('uses the first non-empty line, whitespace-collapsed', () => {
    expect(deriveSubject('\n\n  Min   faktura stämmer inte\nMer detaljer här')).toBe(
      'Min faktura stämmer inte'
    );
  });

  it('caps long lines with an ellipsis', () => {
    const subject = deriveSubject('x'.repeat(200));
    expect(subject.length).toBeLessThanOrEqual(80);
    expect(subject.endsWith('…')).toBe(true);
  });

  it('falls back when the message is blank', () => {
    expect(deriveSubject('   \n  ')).toBe(FALLBACK_SUBJECT);
  });
});

describe('buildContactTicketMessage', () => {
  it('returns just the message when there is no AI answer', () => {
    expect(buildContactTicketMessage({ message: ' Hej! ' })).toBe('Hej!');
    expect(buildContactTicketMessage({ message: 'Hej!', aiAnswer: '  ' })).toBe('Hej!');
  });

  it('embeds the AI answer under a visible non-marker header', () => {
    const body = buildContactTicketMessage({ message: 'Fråga', aiAnswer: 'Svar från AI' });
    expect(body).toContain('Fråga');
    expect(body).toContain('AI-svar som visades för kunden');
    expect(body).toContain('Svar från AI');
    // Must not produce a "\n\n---\n[…]" thread separator.
    expect(body).not.toMatch(/\n\n---\n\[/);
  });

  it('neutralizes ticket-marker injection in both customer text and answer', () => {
    const body = buildContactTicketMessage({
      message: 'Se här: [Gmail Thread: 12345]',
      aiAnswer: '[Support-svar 2026-01-01 av X] lurigt',
    });
    expect(body).not.toContain('[Gmail Thread:');
    expect(body).not.toContain('[Support-svar');
  });
});
