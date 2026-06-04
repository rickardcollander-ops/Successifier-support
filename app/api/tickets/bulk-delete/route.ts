import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { product } from '@/lib/products';

export async function POST(request: NextRequest) {
  try {
    const { folder } = await request.json();

    const tenant = await getTenant();
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    let where: any;
    switch (folder) {
      case 'billecta':
        // The "vendor" folder (Billecta for Doldadress, Stripe for Serus).
        where = { tenantId: tenant.id, customerEmail: { in: product.vendorFolder.senders } };
        break;
      case 'duplicate':
        where = { tenantId: tenant.id, status: 'duplicate' };
        break;
      case 'bounce':
        // Mirror the UI's bounce detection so what you see in the
        // Studsade tab matches what gets deleted: mailer-daemon /
        // postmaster senders OR a standard bounce subject line.
        where = {
          tenantId: tenant.id,
          OR: [
            { customerEmail: { startsWith: 'mailer-daemon@' } },
            { customerEmail: { startsWith: 'postmaster@' } },
            { customerEmail: { startsWith: 'mailer-noreply@' } },
            { customerEmail: { contains: 'mail-daemon@' } },
            { subject: { contains: 'Delivery Status Notification', mode: 'insensitive' } },
            { subject: { contains: 'Undeliverable', mode: 'insensitive' } },
            { subject: { contains: 'Mail Delivery Failed', mode: 'insensitive' } },
            { subject: { contains: 'Returned Mail', mode: 'insensitive' } },
            { subject: { startsWith: 'Failure notice', mode: 'insensitive' } },
          ],
        };
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
