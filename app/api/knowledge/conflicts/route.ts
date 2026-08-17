import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { getTenantId } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';
import { CONFLICT_STATUS } from '@/lib/services/knowledge-cards';

const VALID_STATUSES = new Set(Object.values(CONFLICT_STATUS));

// The review queue: contradictions between a card's accepted answer and
// what an agent actually sent. Defaults to the open ones, which is the
// working view — resolved and dismissed are available for auditing.
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: `Tenant '${product.key}' not found` }, { status: 404 });
    }

    const statusParam = request.nextUrl.searchParams.get('status') ?? CONFLICT_STATUS.open;
    const status = VALID_STATUSES.has(statusParam as never) ? statusParam : CONFLICT_STATUS.open;

    const conflicts = await prisma.knowledgeCardConflict.findMany({
      where: { tenantId, status },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        card: {
          select: { id: true, question: true, category: true, confirmedCount: true, curatedBy: true },
        },
      },
    });

    return NextResponse.json({ conflicts });
  } catch (error) {
    console.error('Error fetching knowledge conflicts:', error);
    return NextResponse.json({ error: 'Failed to fetch knowledge conflicts' }, { status: 500 });
  }
}
