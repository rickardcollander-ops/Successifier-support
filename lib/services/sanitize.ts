// Neutralize ticket markers in inbound (customer-controlled) text.
//
// Conversations are stored as one text blob in Ticket.originalMessage with
// bracketed markers stamped by our own code: [Gmail Thread: …],
// [Gmail ID: …], [Inbox account: …], [Message-Id: …], [Följdmail …],
// [Support-svar …], [Intern kommentar …], [SPAM]. Several code paths parse
// these back out with regex/contains — most critically the Gmail-thread
// dedup in lib/services/deduplicator.ts, where a customer who includes
// "[Gmail Thread: <someone else's thread id>]" in their email body would get
// their message merged into another customer's ticket.
//
// We insert a zero-width space after the opening bracket of any such marker
// found in inbound text. Invisible to agents reading the ticket, but it no
// longer matches any marker parsing.

const MARKER_PATTERN =
  /\[(?=\s*(?:Gmail Thread|Gmail ID|Inbox account|Message-Id|Följdmail|Support-svar|Intern kommentar|SPAM)\b)/gi;

export function sanitizeInboundText(text: string): string {
  if (!text) return text;
  return text.replace(MARKER_PATTERN, '[\u200B');
}
