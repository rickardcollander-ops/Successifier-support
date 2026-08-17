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
  language: 'en',
  supportName: 'Serus Support',
  fromName: 'Serus Support',
  apiKeyPrefix: 'seru',
  apiBaseDomain: 'serus.ai',
  integrations: ['stripe', 'clerk'],
  showAffectedCustomersTool: false,
  // Serus support reads English but gets mail in many languages (French,
  // German, …) — let agents translate incoming customer messages on demand.
  translateIncoming: true,
  // Serus vill inte skicka något automatiskt bekräftelsemail till kunden
  // när ett nytt ärende öppnas.
  sendConfirmation: false,
  // Serus använder Stripe (inte Billecta) som betalleverantör — samla
  // automatiska mejl från Stripe i en egen "Stripe"-mapp.
  vendorFolder: {
    label: 'Stripe',
    senders: ['no-reply@stripe.com', 'support@stripe.com'],
  },
  allowedDomains: ['serus.ai'],
  adminEmails: ['ida@serus.ai'],
  // Same support team as Doldadress, plus Anthon Wansland and Argjent Sahiti.
  // Names must match how the agents appear in their Google accounts.
  agents: ['Ida Rosell', 'Malin Sundberg', 'Filippa Kramp', 'Anthon Wansland', 'Argjent Sahiti'],
  ticketCategories: [
    'cancellation',
    'billing & payment',
    'subscription',
    'login & account',
    'technical issue',
    'complaint',
    'other',
  ],
  agentSignatures: {
    'Ida Rosell': 'Best regards,\nIda\nThe Serus Team',
    'Malin Sundberg': 'Best regards,\nMalin\nThe Serus Team',
    'Filippa Kramp': 'Best regards,\nFilippa\nThe Serus Team',
    'Anthon Wansland': 'Best regards,\nAnthon\nThe Serus Team',
    'Argjent Sahiti': 'Best regards,\nArgjent\nThe Serus Team',
  },
  agentColors: {
    'Ida Rosell': { bg: '#DC2626', border: '#B91C1C', text: '#FFFFFF' },
    'Malin Sundberg': { bg: '#16A34A', border: '#15803D', text: '#FFFFFF' },
    'Filippa Kramp': { bg: '#2563EB', border: '#1D4ED8', text: '#FFFFFF' },
    'Anthon Wansland': { bg: '#7C3AED', border: '#6D28D9', text: '#FFFFFF' },
    'Argjent Sahiti': { bg: '#D97706', border: '#B45309', text: '#FFFFFF' },
  },
  confirmation: {
    greeting: 'Hi,',
    bodyLines: [
      'Thanks for reaching out to Serus!',
      'We have received your email and will get back to you as soon as possible, usually within 2 business days.',
      'Have a great day!',
    ],
    signoff: 'Best regards,\nThe Serus Team',
  },
};
