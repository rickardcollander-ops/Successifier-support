import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireApiAuth } from '@/lib/api-auth';
import { getTenantId } from '@/lib/products/tenant';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'your', 'you', 'are', 'was', 'were',
  'det', 'och', 'att', 'som', 'med', 'har', 'fran', 'från', 'till', 'jag', 'min', 'mitt', 'vara',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function hasBillectaMention(text: string): boolean {
  return /billecta/i.test(text);
}

type BillectaInvoice = {
  id?: string;
  number?: string;
  status?: string;
  amount?: number | string;
  dueDate?: string;
  isPaid?: boolean;
  deliveryMethod?: string;
};

type BillectaContextPayload = {
  billecta?: {
    creditorPublicId?: string;
    debtorPublicId?: string;
    invoices?: BillectaInvoice[];
  };
};

function calculateSimilarity(currentText: string, candidateText: string): number {
  const currentTokens = new Set(tokenize(currentText));
  const candidateTokens = new Set(tokenize(candidateText));

  if (currentTokens.size === 0 || candidateTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of currentTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(currentTokens.size, candidateTokens.size);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;

    const tenantId = await getTenantId();
    const ticket = await prisma.ticket.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true,
        tenantId: true,
        customerEmail: true,
        customerName: true,
        subject: true,
        originalMessage: true,
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const customerTickets = await prisma.ticket.findMany({
      where: {
        tenantId: ticket.tenantId,
        customerEmail: ticket.customerEmail,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        subject: true,
        originalMessage: true,
        status: true,
        priority: true,
        createdAt: true,
        customerName: true,
        contextData: true,
      },
    });

    const ticketWithBillectaContext = customerTickets.find((item) => {
      const context = item.contextData as BillectaContextPayload | null;
      return Boolean(context?.billecta);
    });

    const billectaRelatedTickets = customerTickets.filter((item) =>
      hasBillectaMention(`${item.subject} ${item.originalMessage}`)
    );

    const billectaSummary = (() => {
      if (ticketWithBillectaContext) {
        const context = ticketWithBillectaContext.contextData as BillectaContextPayload | null;

        const invoices = context?.billecta?.invoices ?? [];
        const unpaidInvoices = invoices.filter((inv) => inv?.isPaid === false).length;
        const invoicesPreview = invoices.slice(0, 5).map((inv) => ({
          id: inv.id,
          number: inv.number,
          status: inv.status,
          amount: inv.amount,
          dueDate: inv.dueDate,
          isPaid: inv.isPaid,
          deliveryMethod: inv.deliveryMethod,
        }));

        return {
          source: 'context',
          invoices: invoices.length,
          unpaidInvoices,
          relatedTickets: billectaRelatedTickets.length,
          creditorPublicId: context?.billecta?.creditorPublicId || null,
          debtorPublicId: context?.billecta?.debtorPublicId || null,
          invoicesPreview,
        };
      }

      if (billectaRelatedTickets.length > 0) {
        return {
          source: 'history',
          invoices: billectaRelatedTickets.length,
          unpaidInvoices: null,
          relatedTickets: billectaRelatedTickets.length,
          creditorPublicId: null,
          debtorPublicId: null,
          invoicesPreview: [],
        };
      }

      return null;
    })();

    const previousTickets = customerTickets
      .filter((item) => item.id !== ticket.id)
      .slice(0, 10);

    const currentText = `${ticket.subject} ${ticket.originalMessage}`;
    const similarIssues = previousTickets
      .map((item) => {
        const similarityScore = calculateSimilarity(
          currentText,
          `${item.subject} ${item.originalMessage}`
        );

        return {
          id: item.id,
          subject: item.subject,
          status: item.status,
          priority: item.priority,
          createdAt: item.createdAt,
          similarityScore: Math.round(similarityScore * 100),
          snippet: item.originalMessage.slice(0, 180),
        };
      })
      .filter((item) => item.similarityScore >= 20)
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, 5);

    const openTickets = customerTickets.filter(
      (item) => item.status !== 'closed' && item.status !== 'sent'
    ).length;

    return NextResponse.json({
      customer: {
        email: ticket.customerEmail,
        name: ticket.customerName || customerTickets.find((item) => item.customerName)?.customerName || null,
        totalTickets: customerTickets.length,
        openTickets,
        lastTicketAt: customerTickets[0]?.createdAt || null,
      },
      billecta: billectaSummary,
      previousTickets: previousTickets.map((item) => ({
        id: item.id,
        subject: item.subject,
        status: item.status,
        priority: item.priority,
        createdAt: item.createdAt,
      })),
      similarIssues,
    });
  } catch (error) {
    console.error('Error fetching customer history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customer history' },
      { status: 500 }
    );
  }
}
