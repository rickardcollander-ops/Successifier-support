import { describe, expect, it } from 'vitest';
import { applyAgentSignature, stripAgentSignature } from '@/lib/constants';
import { changeRatio } from '@/lib/text-diff';

// The reports compare the stored AI draft (no sign-off) against the sent
// reply (signature appended at send time). stripAgentSignature undoes that
// append so a verbatim send reads as 0% changed instead of "signature-many
// words inserted" — the bug that made the reports over-count manual edits.
describe('stripAgentSignature', () => {
  const draft = 'Hej! Tack för ditt meddelande. Vi har uppdaterat din adress.';

  it('removes the signature applyAgentSignature appended (per-agent)', () => {
    const sent = applyAgentSignature(draft, 'Ida Rosell');
    expect(sent).not.toBe(draft); // sanity: a signature really was added
    expect(stripAgentSignature(sent)).toBe(draft);
  });

  it('removes the signature for an agent resolved by first name / email', () => {
    const sent = applyAgentSignature(draft, 'malin@doldadress.se');
    expect(stripAgentSignature(sent)).toBe(draft);
  });

  it('removes the generic default signature', () => {
    const sent = applyAgentSignature(draft, null);
    expect(stripAgentSignature(sent)).toBe(draft);
  });

  it('leaves text without a known signature untouched', () => {
    const text = 'Hej, jag undrar en sak om min faktura. Mvh Kund';
    expect(stripAgentSignature(text)).toBe(text);
  });

  it('handles null / empty input', () => {
    expect(stripAgentSignature(null)).toBe('');
    expect(stripAgentSignature('')).toBe('');
  });

  it('makes a verbatim send score as 0% changed', () => {
    const sent = applyAgentSignature(draft, 'Filippa Kramp');
    // Before the fix: comparing draft vs sent counts the signature as edits.
    expect(changeRatio(draft, sent)).toBeGreaterThan(0);
    // After stripping both sides it reads as the verbatim send it really is.
    expect(changeRatio(stripAgentSignature(draft), stripAgentSignature(sent))).toBe(0);
  });

  it('still reflects a genuine edit after stripping', () => {
    const edited = 'Hej! Tack för ditt meddelande. Vi har nu ändrat din adress manuellt.';
    const sent = applyAgentSignature(edited, 'Ida Rosell');
    const r = changeRatio(stripAgentSignature(draft), stripAgentSignature(sent));
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0);
  });
});
