// Parses a ticket's merged originalMessage into a chronological
// conversation. A ticket stores its whole thread as one text blob:
// follow-ups, support replies and internal comments are appended with
// "\n\n---\n[Följdmail <ts>]" / "[Support-svar <ts> av <agent>]" /
// "[Intern kommentar <ts> av <agent>]" separators (see deduplicator.ts,
// send/route.ts and comment/route.ts). Inbound text is sanitized before
// storage (sanitize.ts), so any marker found here was written by the
// system, not by a customer. TicketDetail.tsx parses the same format
// for display.

export interface ThreadEntry {
  role: 'customer' | 'support' | 'internal';
  // Timestamp string from the separator marker; null for the original message.
  date: string | null;
  body: string;
}

const SEPARATOR = /\n\n---\n(?=\[(?:Följdmail|Support-svar|Intern kommentar) )/;
const MARKER_LINE = /^\[(?:Följdmail |Support-svar |Intern kommentar |Gmail ID:|Gmail Thread:|Inbox account:|Message-Id:)/;

export function parseTicketThread(originalMessage: string): ThreadEntry[] {
  const parts = originalMessage.split(SEPARATOR);
  const entries: ThreadEntry[] = [];

  parts.forEach((part, idx) => {
    const isSupport = idx > 0 && part.startsWith('[Support-svar ');
    const isInternal = idx > 0 && part.startsWith('[Intern kommentar ');
    const markerMatch = idx > 0
      ? part.match(/^\[(?:Följdmail|Support-svar|Intern kommentar) ([^\]]+?)(?:\]| av [^\]]+\])/)
      : null;

    const lines: string[] = [];
    for (const line of part.replace(/\n?\[DrabbadHanterad: [^\]]+\]/g, '').split('\n')) {
      if (MARKER_LINE.test(line)) continue;
      // Quoted previous conversation in customer replies ("> …") duplicates
      // what earlier thread entries already contain — drop it.
      if (idx > 0 && !isSupport && !isInternal && line.startsWith('>')) continue;
      lines.push(line);
    }

    const body = lines.join('\n').trim();
    if (!body) return;

    entries.push({
      role: isInternal ? 'internal' : isSupport ? 'support' : 'customer',
      date: markerMatch ? markerMatch[1] : null,
      body,
    });
  });

  return entries;
}
