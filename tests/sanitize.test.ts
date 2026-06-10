import { describe, expect, it } from 'vitest';
import { sanitizeInboundText } from '@/lib/services/sanitize';

describe('lib/services/sanitize', () => {
  it('neutralizes Gmail thread markers so dedup cannot be hijacked', () => {
    const evil = 'Hej!\n[Gmail Thread: someone-elses-thread-id]\nMvh';
    const safe = sanitizeInboundText(evil);
    expect(safe).not.toContain('[Gmail Thread:');
    // The visible text is preserved (only a zero-width space is inserted).
    expect(safe.replace(/\u200B/g, '')).toBe(evil);
  });

  it('neutralizes all marker variants, case-insensitively', () => {
    for (const marker of [
      '[Gmail ID: abc]',
      '[Inbox account: x@y.se]',
      '[Message-Id: <a@b>]',
      '[Följdmail 2026-01-01]',
      '[Support-svar 2026-01-01]',
      '[Intern kommentar 2026-01-01]',
      '[SPAM]',
      '[gmail thread: abc]',
    ]) {
      const safe = sanitizeInboundText(`x ${marker} y`);
      expect(safe.toLowerCase()).not.toContain(marker.toLowerCase());
    }
  });

  it('leaves ordinary brackets and text untouched', () => {
    const text = 'Pris [inkl moms] är 100 kr [se bilaga]';
    expect(sanitizeInboundText(text)).toBe(text);
    expect(sanitizeInboundText('')).toBe('');
  });
});
