import { NextRequest, NextResponse } from 'next/server';
import { product } from '@/lib/products';
import { getTenantId } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';
import {
  CONFLICT_RESOLUTION,
  dismissConflict,
  resolveConflict,
} from '@/lib/services/knowledge-cards';

const VALID_RESOLUTIONS = new Set(Object.values(CONFLICT_RESOLUTION));

const ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  already_resolved: 409,
  missing_merged_answer: 400,
};

// Settle one conflict. The agent either keeps the card's answer, accepts
// the one that was just sent, or writes a merged answer by hand — and may
// dismiss the conflict entirely when the two answers never actually
// disagreed. Nothing here is decided by a model.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: `Tenant '${product.key}' not found` }, { status: 404 });
    }

    const body = await request.json();
    const resolvedBy = authResult.via === 'session' ? authResult.userEmail : 'api';

    if (body.action === 'dismiss') {
      const result = await dismissConflict(tenantId, id, resolvedBy);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: ERROR_STATUS[result.error] ?? 400 });
      }
      return NextResponse.json({ success: true, cardId: result.cardId });
    }

    if (!VALID_RESOLUTIONS.has(body.resolution)) {
      return NextResponse.json(
        { error: 'resolution måste vara kept_current, accepted_proposed eller merged' },
        { status: 400 }
      );
    }

    const result = await resolveConflict({
      tenantId,
      conflictId: id,
      resolution: body.resolution,
      mergedAnswer: typeof body.mergedAnswer === 'string' ? body.mergedAnswer : undefined,
      resolvedBy,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: ERROR_STATUS[result.error] ?? 400 });
    }
    return NextResponse.json({ success: true, cardId: result.cardId });
  } catch (error) {
    console.error('Error resolving knowledge conflict:', error);
    return NextResponse.json({ error: 'Failed to resolve knowledge conflict' }, { status: 500 });
  }
}
