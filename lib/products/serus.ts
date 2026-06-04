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
  apiKeyPrefix: 'seru',
  apiBaseDomain: 'serus.ai',
  allowedDomains: ['serus.se'], // TODO: confirm Serus sign-in domain(s)
  agents: [], // TODO: add Serus agents (must match how they appear in Google)
  agentSignatures: {
    // 'Förnamn Efternamn': 'Vänliga hälsningar,\nFörnamn\nSupportteamet Serus.se',
  },
  agentColors: {
    // 'Förnamn Efternamn': { bg: '#2563EB', border: '#1D4ED8', text: '#FFFFFF' },
  },
  confirmation: {
    greeting: 'Hej,',
    bodyLines: [
      'Tack för att du kontaktar oss!',
      'Vi har tagit emot ditt mejl. Vi hanterar ditt ärende så snart som möjligt och svarar normalt inom 2 arbetsdagar.',
      // TODO (Serus onboarding): add a "vår supportsida: https://…" line once
      // the public support URL is confirmed.
      'Ha en fin dag!',
    ],
    signoff: 'Med vänliga hälsningar,\nTeamet på Serus.se',
  },
};
