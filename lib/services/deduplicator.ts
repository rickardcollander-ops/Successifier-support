import { prisma } from '@/lib/db/client';

// Window used to detect duplicates. Two messages from the same sender within
// this span are treated as the same conversation. Extended from 60s to 5 min
// after support saw bursts of duplicates landing just outside the old window.
export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

function normalizeSubject(subject: string): string {
  return subject.replace(/^(Re|Sv|Fwd|Fw):\s*/i, '').trim().toLowerCase();
}

interface MergeArgs {
  tenantId: string;
  customerEmail: string;
  subject: string;
  body: string;
  gmailMessageId?: string | null;
}

interface MergeResult {
  merged: boolean;
  mergedIntoTicketId?: string;
}

// Look for a recent ticket from the same sender with the same (normalized)
// subject. If found, append this message to it and return merged=true so the
// caller skips creating a new ticket. Archived/duplicate tickets are
// excluded — we don't want to resurrect them.
export async function mergeIfDuplicate(args: MergeArgs): Promise<MergeResult> {
  const { tenantId, customerEmail, subject, body, gmailMessageId } = args;
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const normalized = normalizeSubject(subject);

  const candidates = await prisma.ticket.findMany({
    where: {
      tenantId,
      customerEmail,
      createdAt: { gte: since },
      status: { notIn: ['archived', 'duplicate'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const match = candidates.find((c) => normalizeSubject(c.subject) === normalized);
  if (!match) {
    return { merged: false };
  }

  // Guard against re-appending the same Gmail message (can happen when the
  // sync runs twice before the message is marked read).
  if (gmailMessageId && match.originalMessage.includes(`[Gmail ID: ${gmailMessageId}]`)) {
    return { merged: true, mergedIntoTicketId: match.id };
  }

  const separator = `\n\n---\n[Följdmail ${new Date().toLocaleString('sv-SE')}]\n`;
  const appendedBody = gmailMessageId ? `[Gmail ID: ${gmailMessageId}]\n${body}` : body;

  await prisma.ticket.update({
    where: { id: match.id },
    data: {
      originalMessage: `${match.originalMessage}${separator}${appendedBody}`,
      status: match.status === 'new' ? 'new' : 'in_progress',
      updatedAt: new Date(),
    },
  });

  return { merged: true, mergedIntoTicketId: match.id };
}
