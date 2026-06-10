// How much did an agent actually change the AI draft before sending? We diff
// at the word level (not character level): it matches how a human perceives an
// edit ("changed a handful of words") and keeps the cost bounded for the
// reports endpoint, which runs this over every reply in the window.

// Long bodies are capped so a runaway DP can't stall the report. 400 words is
// well past a normal support reply; beyond that the ratio is already stable.
const MAX_WORDS = 400;

export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, MAX_WORDS);
}

// Levenshtein distance over two word arrays (insert/delete/substitute = 1).
// Rolling two-row DP so memory is O(min(n,m)).
export function wordEditDistance(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Keep the inner loop over the shorter array.
  if (b.length < a.length) [a, b] = [b, a];

  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr = new Array(a.length + 1).fill(0);
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1, // deletion
        curr[i - 1] + 1, // insertion
        prev[i - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

// Fraction of the AI draft that the agent changed, 0..1. 0 = sent verbatim,
// 1 = completely rewritten. Returns null when there's nothing to compare
// (no AI draft, or no final text) so callers can exclude those tickets rather
// than count them as "0% changed".
export function changeRatio(
  aiResponse: string | null | undefined,
  finalResponse: string | null | undefined
): number | null {
  const ai = tokenize(aiResponse);
  const fin = tokenize(finalResponse);
  if (ai.length === 0 || fin.length === 0) return null;
  const distance = wordEditDistance(ai, fin);
  return Math.min(1, distance / Math.max(ai.length, fin.length));
}
