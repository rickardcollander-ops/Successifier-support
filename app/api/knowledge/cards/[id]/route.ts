import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { getTenantId } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';
import { CARD_STATUS } from '@/lib/services/knowledge-cards';

const VALID_STATUSES = new Set(Object.values(CARD_STATUS));

async function scopedCard(id: string) {
  const tenantId = await getTenantId();
  if (!tenantId) return { tenantId: null, card: null };
  const card = await prisma.knowledgeCard.findFirst({ where: { id, tenantId } });
  return { tenantId, card };
}

// One card with its provenance: which tickets confirmed the answer and
// which contradictions have been raised against it. This is the "why does
// the system believe this?" view.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    const { tenantId, card } = await scopedCard(id);
    if (!tenantId) {
      return NextResponse.json({ error: `Tenant '${product.key}' not found` }, { status: 404 });
    }
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 });

    const [sources, conflicts] = await Promise.all([
      prisma.knowledgeCardSource.findMany({
        where: { cardId: id },
        orderBy: { sentAt: 'desc' },
        take: 50,
      }),
      prisma.knowledgeCardConflict.findMany({
        where: { cardId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return NextResponse.json({ card, sources, conflicts });
  } catch (error) {
    console.error('Error fetching knowledge card:', error);
    return NextResponse.json({ error: 'Failed to fetch knowledge card' }, { status: 500 });
  }
}

// Manual curation. Editing the answer stamps curatedAt/curatedBy, which is
// what stops a later contradicting reply from silently overwriting a human
// decision — it raises a conflict instead.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    const { tenantId, card } = await scopedCard(id);
    if (!tenantId) {
      return NextResponse.json({ error: `Tenant '${product.key}' not found` }, { status: 404 });
    }
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 });

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (typeof body.question === 'string' && body.question.trim()) {
      data.question = body.question.trim();
    }
    if (typeof body.answer === 'string' && body.answer.trim()) {
      data.answer = body.answer.trim();
      data.curatedAt = new Date();
      data.curatedBy = authResult.via === 'session' ? authResult.userEmail : 'api';
    }
    if (typeof body.category === 'string' || body.category === null) {
      data.category = body.category;
    }
    if (Array.isArray(body.tags) && body.tags.every((t: unknown) => typeof t === 'string')) {
      data.tags = body.tags;
    }
    if (typeof body.status === 'string' && VALID_STATUSES.has(body.status as never)) {
      // A card is only allowed back to 'active' by hand when nothing is
      // still contested — otherwise the review queue could be bypassed.
      if (body.status === CARD_STATUS.active) {
        const openConflicts = await prisma.knowledgeCardConflict.count({
          where: { cardId: id, status: 'open' },
        });
        if (openConflicts > 0) {
          return NextResponse.json(
            { error: 'Kortet har olösta konflikter och kan inte aktiveras än' },
            { status: 409 }
          );
        }
      }
      data.status = body.status;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Inget att uppdatera' }, { status: 400 });
    }

    const updated = await prisma.knowledgeCard.update({ where: { id }, data });
    return NextResponse.json({ card: updated });
  } catch (error) {
    console.error('Error updating knowledge card:', error);
    return NextResponse.json({ error: 'Failed to update knowledge card' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    const { tenantId, card } = await scopedCard(id);
    if (!tenantId) {
      return NextResponse.json({ error: `Tenant '${product.key}' not found` }, { status: 404 });
    }
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 });

    await prisma.knowledgeCard.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting knowledge card:', error);
    return NextResponse.json({ error: 'Failed to delete knowledge card' }, { status: 500 });
  }
}
