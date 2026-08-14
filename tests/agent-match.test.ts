import { describe, expect, it } from 'vitest';
import { resolveAgentName } from '@/lib/agent-match';

// Default product in tests is doldadress with agents
// 'Ida Rosell', 'Malin Sundberg', 'Filippa Kramp'.

describe('lib/agent-match', () => {
  it('returns canonical names unchanged', () => {
    expect(resolveAgentName('Malin Sundberg')).toBe('Malin Sundberg');
  });

  it('resolves emails and case variants to the canonical name', () => {
    expect(resolveAgentName('malin@doldadress.se')).toBe('Malin Sundberg');
    expect(resolveAgentName('MALIN SUNDBERG')).toBe('Malin Sundberg');
    expect(resolveAgentName('ida.rosell@doldadress.se')).toBe('Ida Rosell');
  });

  it('matches on whole tokens — "frida@" must NOT resolve to Ida', () => {
    // The documented regression: a substring test credited frida@… to Ida.
    expect(resolveAgentName('frida@doldadress.se')).toBeNull();
  });

  it('returns null for unknown or empty values', () => {
    expect(resolveAgentName('someone@example.com')).toBeNull();
    expect(resolveAgentName('')).toBeNull();
    expect(resolveAgentName(null)).toBeNull();
    expect(resolveAgentName(undefined)).toBeNull();
  });
});
