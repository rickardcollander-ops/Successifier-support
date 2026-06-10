import { describe, expect, it } from 'vitest';
import { tokenize, wordEditDistance, changeRatio } from '@/lib/text-diff';

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
