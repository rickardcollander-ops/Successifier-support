import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { requireSession } from '@/lib/api-auth';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const { keyId } = await params;
    const subdomain = product.key;
    
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain },
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    await prisma.apiKey.delete({
      where: {
        id: keyId,
        tenantId: tenant.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting API key:', error);
    return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const { keyId } = await params;
    const subdomain = product.key;
    
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain },
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const { isActive } = await request.json();

    const apiKey = await prisma.apiKey.update({
      where: {
        id: keyId,
        tenantId: tenant.id,
      },
      data: { isActive },
    });

    return NextResponse.json({ apiKey });
  } catch (error) {
    console.error('Error updating API key:', error);
    return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 });
  }
}
