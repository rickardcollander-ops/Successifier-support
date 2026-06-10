import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenantId } from '@/lib/products/tenant';
import { encryptJSON } from '@/lib/crypto';
import { requireSession } from '@/lib/api-auth';
import { decryptCredentials, maskCredentials, mergeCredentials } from '@/lib/integrations/credentials';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const { id } = await params;
    const tenantId = await getTenantId();

    const existing = await prisma.integration.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    }

    const updateData = { ...body };
    let responseCredentials = maskCredentials(decryptCredentials(existing.credentials));
    if (updateData.credentials) {
      const merged = mergeCredentials(
        decryptCredentials(existing.credentials),
        updateData.credentials
      );
      updateData.credentials = encryptJSON(merged) as any;
      responseCredentials = maskCredentials(merged);
    }

    const integration = await prisma.integration.update({
      where: { id: existing.id },
      data: updateData,
    });

    return NextResponse.json({
      ...integration,
      credentials: responseCredentials,
    });
  } catch (error) {
    console.error('Error updating integration:', error);
    return NextResponse.json(
      { error: 'Failed to update integration' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    const tenantId = await getTenantId();

    const existing = await prisma.integration.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    }

    await prisma.integration.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting integration:', error);
    return NextResponse.json(
      { error: 'Failed to delete integration' },
      { status: 500 }
    );
  }
}
