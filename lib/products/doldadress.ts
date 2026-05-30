import type { ProductConfig } from './types';

// Doldadress — the original product. These values reproduce exactly what
// used to be hardcoded across the codebase before it was made multi-product.
export const doldadress: ProductConfig = {
  key: 'doldadress',
  displayName: 'Doldadress',
  brandName: 'Doldadress',
  supportName: 'Doldadress Kundtjänst',
  fromName: 'Doldadress Kundtjänst',
  apiKeyPrefix: 'dold',
  apiBaseDomain: 'doldadress.com',
  allowedDomains: ['doldadress.se', 'becomeanon.com'],
  agents: ['Ida Rosell', 'Malin Sundberg', 'Filippa Kramp'],
  agentSignatures: {
    'Ida Rosell': 'Vänliga hälsningar,\nIda\nSupportteamet Doldadress.se',
    'Malin Sundberg': 'Vänliga hälsningar,\nMalin\nSupportteamet Doldadress.se',
    'Filippa Kramp': 'Vänliga hälsningar,\nFilippa\nSupportteamet Doldadress.se',
  },
  agentColors: {
    'Ida Rosell': { bg: '#DC2626', border: '#B91C1C', text: '#FFFFFF' },
    'Malin Sundberg': { bg: '#16A34A', border: '#15803D', text: '#FFFFFF' },
    'Filippa Kramp': { bg: '#2563EB', border: '#1D4ED8', text: '#FFFFFF' },
  },
  confirmation: {
    bodyLine:
      'Tack för att du kontaktar Doldadress Kundtjänst. Vi har tagit emot ditt mejl och återkommer till dig så snart vi kan, vanligen inom 24 timmar på vardagar.',
    signoff: 'Doldadress Kundtjänst',
  },
};
