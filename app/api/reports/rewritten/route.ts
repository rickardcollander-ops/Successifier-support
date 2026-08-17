import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { stripAgentSignature } from '@/lib/constants';
import { isVendorTicket, isBounceTicket } from '@/lib/ticket-filters';
import { requireApiAuth } from '@/lib/api-auth';
import { keptFromDraftRatio } from '@/lib/text-diff';
import { resolveReportWindow } from '@/lib/report-window';

// Drill-down behind the "Hur mycket bygger svaren på AI-utkastet?" panel:
// the actual replies where agents rewrote the draft, draft and sent version
// side by side. This is the working list for improving the AI — each entry
// shows what the draft got wrong and what the right answer was, which is
// exactly what a missing/incorrect KB article looks like in practice.
//
// Same range parameters, exclusions and kept-ratio math as /api/reports, so
// the list always reconciles with the panel's counts.

const ZENDESK_IMPORT_MARKER = '[Zendesk Import Source:';

// Cap the texts per item — the UI shows excerpts, not full emails.
const MAX_TEXT = 1500;
// Cap the list — newest first; beyond this the pattern is already visible.
const MAX_ITEMS = 100;

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    // 'heavy' (>50% new, default) or 'edited' (any edit: >10% new).
    const scope = searchParams.get('scope') === 'edited' ? 'edited' : 'heavy';

    const tenant = await getTenant();
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const { windowStart, windowEnd } = resolveReportWindow(
      range,
      searchParams.get('from'),
      searchParams.get('to')
    );

    const sentRows = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        sentAt: { gte: windowStart, lt: windowEnd },
        aiResponse: { not: null },
        finalResponse: { not: null },
        NOT: {
          originalMessage: { contains: ZENDESK_IMPORT_MARKER },
        },
      },
      orderBy: { sentAt: 'desc' },
      select: {
        id: true,
        subject: true,
        customerEmail: true,
        sentAt: true,
        sentBy: true,
        status: true,
        aiResponse: true,
        finalResponse: true,
        originalMessage: true,
      },
    });

    // The authoritative "sent unedited" flag — those replies never belong in
    // this list even if the stored texts differ by some incidental character.
    const feedbackRows = await prisma.aIResponseFeedback.findMany({
      where: { tenantId: tenant.id, createdAt: { gte: windowStart, lte: windowEnd } },
      select: { ticketId: true, wasEdited: true },
      orderBy: { createdAt: 'asc' },
    });
    const editedByTicket = new Map<string, boolean>();
    for (const f of feedbackRows) editedByTicket.set(f.ticketId, f.wasEdited); // last write wins

    const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
    // Same reduction as /api/reports: drop the inline-image HTML tail and the
    // auto-appended signature before comparing.
    const comparableBody = (s: string | null | undefined) =>
      stripAgentSignature((s ?? '').split('[INLINE_IMAGES]')[0]);
    // Customer question = first thread segment, minus sync metadata headers.
    const questionExcerpt = (originalMessage: string) =>
      originalMessage
        .replace(/\[Gmail ID:.*?\]\n?(\[Message-Id:.*?\]\n?)?(\[Inbox account:.*?\]\n?)?\n?/g, '')
        .split(/\n---\n/)[0]
        .substring(0, MAX_TEXT)
        .trim();

    const threshold = scope === 'edited' ? 0.9 : 0.5;
    const items: Array<{
      ticketId: string;
      subject: string;
      customerEmail: string;
      sentAt: Date | null;
      sentBy: string | null;
      keptPct: number;
      question: string;
      aiDraft: string;
      sentReply: string;
    }> = [];

    for (const t of sentRows) {
      if (isVendorTicket(t) || isBounceTicket(t)) continue;
      if (editedByTicket.get(t.id) === false) continue; // sent verbatim

      const draft = comparableBody(t.aiResponse);
      const sent = comparableBody(t.finalResponse);
      if (norm(draft) === '' || norm(sent) === '') continue;

      const kept = keptFromDraftRatio(draft, sent);
      if (kept == null || kept >= threshold) continue;

      items.push({
        ticketId: t.id,
        subject: t.subject,
        customerEmail: t.customerEmail,
        sentAt: t.sentAt,
        sentBy: t.sentBy,
        keptPct: Math.round(kept * 100),
        question: questionExcerpt(t.originalMessage),
        aiDraft: draft.substring(0, MAX_TEXT).trim(),
        sentReply: sent.substring(0, MAX_TEXT).trim(),
      });
      if (items.length >= MAX_ITEMS) break;
    }

    return NextResponse.json({ scope, total: items.length, items });
  } catch (error) {
    console.error('Error fetching rewritten replies:', error);
    return NextResponse.json(
      { error: 'Failed to fetch rewritten replies' },
      { status: 500 }
    );
  }
}
