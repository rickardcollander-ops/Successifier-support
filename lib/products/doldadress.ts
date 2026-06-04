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
  integrations: ['stripe', 'billecta', 'retool', 'resend', 'gmail', 'postman'],
  showAffectedCustomersTool: true,
  sendConfirmation: true,
  vendorFolder: {
    label: 'Billecta',
    senders: ['no-reply@billecta.com'],
  },
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
    greeting: 'Hej,',
    bodyLines: [
      'Tack för att du kontaktar oss! 🛡️',
      'Vi har tagit emot ditt mejl. Vi hanterar ditt ärende så snart som möjligt och svarar normalt inom 2 arbetsdagar.',
      'Om du vill ha svar direkt kan du hitta våra vanligaste frågor och guider på vår supportsida: https://www.doldadress.se/support',
      'Ha en fin dag!',
    ],
    signoff: 'Med vänliga hälsningar,\nTeamet på Doldadress.se',
  },
};
