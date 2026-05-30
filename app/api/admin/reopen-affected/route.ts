import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { auth } from '@/lib/auth';

// Reopen every ticket that's still sitting in "sent" or "closed" with at
// least one customer follow-up appended after the agent considered it
// done. Those are the tickets that were silently buried by the
// stäng-ärende-bugg — see /api/admin/affected-by-closed-reply-bug for
// the read-only listing. This endpoint flips them all back to
// in_progress so support sees them in Öppna and can respond.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenant = await getTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const result = await prisma.ticket.updateMany({
    where: {
      tenantId: tenant.id,
      status: { in: ['sent', 'closed'] },
      originalMessage: { contains: '[Följdmail' },
    },
    data: { status: 'in_progress' },
  });

  return NextResponse.json({
    success: true,
    reopened: result.count,
  });
}
