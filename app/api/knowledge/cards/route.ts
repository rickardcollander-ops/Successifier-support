import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { getTenantId } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';
import { CARD_STATUS } from '@/lib/services/knowledge-cards';

const VALID_STATUSES = new Set(Object.values(CARD_STATUS));

// Knowledge cards for the current tenant, newest confirmation first — the
// list behind /knowledge/cards. Cards in 'review' are surfaced with their
// open-conflict count so the queue is visible without a second request.
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: `Tenant '${product.key}' not found` }, { status: 404 });
    }

    const statusParam = request.nextUrl.searchParams.get('status');
    const status = statusParam && VALID_STATUSES.has(statusParam as never) ? statusParam : null;

    const cards = await prisma.knowledgeCard.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { lastConfirmedAt: 'desc' },
      take: 200,
      include: {
        _count: { select: { sources: true } },
        conflicts: {
          where: { status: 'open' },
          select: { id: true },
        },
      },
    });

    return NextResponse.json({
      cards: cards.map(card => ({
        id: card.id,
        question: card.question,
        answer: card.answer,
        category: card.category,
        tags: card.tags,
        status: card.status,
        confirmedCount: card.confirmedCount,
        lastConfirmedAt: card.lastConfirmedAt,
        curatedAt: card.curatedAt,
        curatedBy: card.curatedBy,
        sourceCount: card._count.sources,
        openConflicts: card.conflicts.length,
      })),
    });
  } catch (error) {
    console.error('Error fetching knowledge cards:', error);
    return NextResponse.json({ error: 'Failed to fetch knowledge cards' }, { status: 500 });
  }
}
