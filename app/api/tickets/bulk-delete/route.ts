import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';

const BILLECTA_SENDER = 'no-reply@billecta.com';

export async function POST(request: NextRequest) {
  try {
    const { folder } = await request.json();

    const hostname = request.nextUrl.hostname;
    const subdomain =
      hostname === 'localhost' || hostname === '127.0.0.1'
        ? 'doldadress'
        : hostname.split('.')[0];

    const tenant = await prisma.tenant.findUnique({ where: { subdomain } });
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    let where: any;
    switch (folder) {
      case 'billecta':
        where = { tenantId: tenant.id, customerEmail: BILLECTA_SENDER };
        break;
      case 'duplicate':
        where = { tenantId: tenant.id, status: 'duplicate' };
        break;
      default:
        return NextResponse.json(
          { error: `Bulk delete is not allowed for folder "${folder}"` },
          { status: 400 }
        );
    }

    const result = await prisma.ticket.deleteMany({ where });
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (error) {
    console.error('Error bulk-deleting tickets:', error);
    return NextResponse.json(
      { error: 'Failed to bulk delete tickets' },
      { status: 500 }
    );
  }
}
