import { describe, expect, it } from 'vitest';
import { tokenize, wordEditDistance, changeRatio, wordLcsLength, keptFromDraftRatio } from '@/lib/text-diff';

describe('lib/text-diff', () => {
  it('tokenizes into lowercased words', () => {
    expect(tokenize('Hej  Världen\nOk')).toEqual(['hej', 'världen', 'ok']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });

  it('measures word edit distance', () => {
    expect(wordEditDistance(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
    expect(wordEditDistance(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1); // one sub
    expect(wordEditDistance(['a', 'b'], ['a', 'b', 'c'])).toBe(1); // one insert
    expect(wordEditDistance([], ['a', 'b'])).toBe(2);
  });

  it('returns 0 change when the draft is sent verbatim', () => {
    expect(changeRatio('Tack för ditt meddelande', 'Tack för ditt meddelande')).toBe(0);
  });

  it('returns a partial ratio for light edits', () => {
    // 1 of 5 words changed → 0.2
    const r = changeRatio('hej du fina värld idag', 'hej du fina värld imorgon');
    expect(r).toBeCloseTo(0.2, 5);
  });

  it('caps a full rewrite at 1', () => {
    const r = changeRatio('aaa bbb ccc', 'xxx yyy zzz www');
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThanOrEqual(0.5);
    expect(r!).toBeLessThanOrEqual(1);
  });

  it('returns null when there is nothing to compare', () => {
    expect(changeRatio(null, 'something')).toBeNull();
    expect(changeRatio('draft', '')).toBeNull();
  });
});

describe('wordLcsLength', () => {
  it('counts the longest common subsequence of words', () => {
    expect(wordLcsLength(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(3);
    expect(wordLcsLength(['a', 'b', 'c', 'd'], ['a', 'c'])).toBe(2); // subsequence
    expect(wordLcsLength(['a', 'b'], ['x', 'y'])).toBe(0);
    expect(wordLcsLength([], ['a'])).toBe(0);
  });
});

describe('keptFromDraftRatio', () => {
  it('is 1 when the reply was sent verbatim', () => {
    expect(keptFromDraftRatio('tack för ditt meddelande', 'tack för ditt meddelande')).toBe(1);
  });

  it('is 1 when the agent only CONDENSED the draft (kept words are a subsequence)', () => {
    // The whole sent reply still appears, in order, inside the longer draft —
    // trimming must not be punished, that's the entire point of this metric.
    const draft = 'hej anna tack för ditt meddelande vi har nu uppdaterat din adress i systemet';
    const sent = 'hej anna vi har uppdaterat din adress';
    expect(keptFromDraftRatio(draft, sent)).toBe(1);
  });

  it('drops toward 0 when the agent wrote new words not in the draft', () => {
    const draft = 'tack för ditt meddelande';
    const sent = 'jag ringer dig imorgon klockan tre'; // shares nothing
    expect(keptFromDraftRatio(draft, sent)).toBe(0);
  });

  it('is partial when the reply mixes draft words and new words', () => {
    // 2 of the 4 sent words ("tack", "meddelande") come from the draft.
    const r = keptFromDraftRatio('tack för ditt meddelande', 'tack följande meddelande nu');
    expect(r).toBeCloseTo(0.5, 5);
  });

  it('returns null when there is nothing to compare', () => {
    expect(keptFromDraftRatio(null, 'x')).toBeNull();
    expect(keptFromDraftRatio('x', '')).toBeNull();
  });
});
