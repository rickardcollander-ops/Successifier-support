import { prisma } from '@/lib/db/client';
import { queueTicketWebhook } from '@/lib/webhooks/dispatch';

// Single write path for an AI draft. Every generator (ticket intake, the
// manual "Generera AI" button, the bulk run, both inbox syncs) previously
// repeated this UPDATE by hand, which is why an outbound
// `ticket.ai_response_generated` event had nowhere to hang.
//
// The write stays raw SQL on purpose: it must NOT bump updatedAt. AI
// generation is not customer activity and should not reorder the ticket
// list — the delta poll picks the row up via contentRefreshedAt instead.
export async function saveAiDraft(params: {
  ticketId: string;
  aiResponse: string;
  confidence: number;
  // Only the manual regeneration path refreshes the gathered context.
  contextData?: unknown;
}): Promise<void> {
  const { ticketId, aiResponse, confidence } = params;

  if (params.contextData !== undefined) {
    await prisma.$executeRaw`
      UPDATE "Ticket"
      SET "aiResponse" = ${aiResponse},
          "aiConfidence" = ${confidence},
          "contextData" = ${JSON.stringify(params.contextData)}::jsonb,
          "contentRefreshedAt" = NOW()
      WHERE id = ${ticketId}
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE "Ticket"
      SET "aiResponse" = ${aiResponse},
          "aiConfidence" = ${confidence},
          "contentRefreshedAt" = NOW()
      WHERE id = ${ticketId}
    `;
  }

  // Webhook subscribers asked to know when the draft is ready, because the
  // ticket.created payload always carries aiResponse: null.
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (ticket) queueTicketWebhook('ticket.ai_response_generated', ticket);
  } catch (error) {
    console.error('Failed to queue ai_response_generated webhook:', error);
  }
}
