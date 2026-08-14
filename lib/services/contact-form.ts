import { sanitizeInboundText } from './sanitize';

// Shared logic for the public AI contact form (/help/kontakt). The form lets
// a customer ask their question, shows an instant AI answer from the public
// knowledge base, and only creates a ticket when the answer didn't solve the
// problem. When a ticket IS created, the AI answer the customer already saw
// is embedded in the ticket body so the agent never repeats it verbatim.

export const CONTACT_MESSAGE_MAX = 5000;
export const CONTACT_NAME_MAX = 120;
export const FALLBACK_SUBJECT = 'Fråga via kontaktformuläret';

// Deliberately simple: we only need to reject obvious garbage, not enforce
// RFC 5322. Anything that survives this still has to receive our reply.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidContactEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/**
 * Derive a ticket subject from the customer's free-text question. The form
 * has no subject field (one box, one question), so the first non-empty line
 * becomes the subject, whitespace-collapsed and capped so the ticket list
 * stays readable.
 */
export function deriveSubject(message: string): string {
  const firstLine = message
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .find((l) => l.length > 0);
  if (!firstLine) return FALLBACK_SUBJECT;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77).trimEnd()}…` : firstLine;
}

// Visible (non-marker) delimiter for the embedded AI answer. Plain text on
// purpose: it must NOT look like the "\n\n---\n[Följdmail …]" thread
// separators that parseTicketThread splits on, so the whole block renders as
// part of the customer's original message.
const AI_ANSWER_HEADER = '——— AI-svar som visades för kunden i kontaktformuläret ———';

/**
 * Compose the ticket body for a contact-form submission. Both the customer's
 * message and the AI answer are customer-controlled input (the answer is
 * echoed back by the client), so both are sanitized against ticket-marker
 * injection before any of our own structure is added.
 */
export function buildContactTicketMessage(opts: { message: string; aiAnswer?: string | null }): string {
  const message = sanitizeInboundText(opts.message.trim());
  const answer = opts.aiAnswer?.trim();
  if (!answer) return message;
  return `${message}\n\n${AI_ANSWER_HEADER}\n${sanitizeInboundText(answer)}`;
}
