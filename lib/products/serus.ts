import type { ProductConfig } from './types';

// Serus — second product sharing this codebase.
//
// TODO (Serus onboarding): fill in the real values below before going live.
//   - allowedDomains: the email domain(s) Serus agents sign in with.
//   - agents / agentSignatures / agentColors: the real support team.
//   - Confirm the brand wording in supportName / fromName / confirmation.
// Everything not listed here (all logic, UI, integrations plumbing) is
// shared with Doldadress automatically — no need to duplicate it.
export const serus: ProductConfig = {
  key: 'serus',
  displayName: 'Serus',
  brandName: 'Serus',
  supportName: 'Serus Kundtjänst',
  fromName: 'Serus Kundtjänst',
  allowedDomains: ['serus.se'], // TODO: confirm Serus sign-in domain(s)
  agents: [], // TODO: add Serus agents (must match how they appear in Google)
  agentSignatures: {
    // 'Förnamn Efternamn': 'Vänliga hälsningar,\nFörnamn\nSupportteamet Serus.se',
  },
  agentColors: {
    // 'Förnamn Efternamn': { bg: '#2563EB', border: '#1D4ED8', text: '#FFFFFF' },
  },
  confirmation: {
    bodyLine:
      'Tack för att du kontaktar Serus Kundtjänst. Vi har tagit emot ditt mejl och återkommer till dig så snart vi kan, vanligen inom 24 timmar på vardagar.',
    signoff: 'Serus Kundtjänst',
  },
};
