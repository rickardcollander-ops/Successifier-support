import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { getTenantId } from '@/lib/products/tenant';
import { encryptJSON } from '@/lib/crypto';
import { requireSession } from '@/lib/api-auth';
import { decryptCredentials, maskCredentials, mergeCredentials } from '@/lib/integrations/credentials';

async function resolveTenantId() {
  const tenantId = await getTenantId();
  if (tenantId) return tenantId;

  // Last-resort fallback for local/dev environments with different seed data
  const firstTenant = await prisma.tenant.findFirst({
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (firstTenant) return firstTenant.id;

  throw new Error(`No tenant found for product '${product.key}'`);
}

export async function GET(request: NextRequest) {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await resolveTenantId();

    const integrations = await prisma.integration.findMany({
      where: { tenantId },
    });

    const masked = integrations.map((integration) => {
      try {
        return {
          ...integration,
          credentials: maskCredentials(decryptCredentials(integration.credentials)),
        };
      } catch (error) {
        console.error(`Failed to read credentials for integration ${integration.id}:`, error);
        return { ...integration, credentials: {} };
      }
    });

    return NextResponse.json({ integrations: masked });
  } catch (error) {
    console.error('Error fetching integrations:', error);
    const details = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'Failed to fetch integrations',
        ...(process.env.NODE_ENV !== 'production' ? { details } : {}),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await resolveTenantId();
    const body = await request.json();
    const { type, credentials } = body;

    if (!type || !credentials) {
      return NextResponse.json(
        { error: 'Type and credentials are required' },
        { status: 400 }
      );
    }

    const existing = await prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type } },
    });
    const existingCredentials = existing ? decryptCredentials(existing.credentials) : {};
    const mergedCredentials = mergeCredentials(existingCredentials, credentials);

    const integration = await prisma.integration.upsert({
      where: {
        tenantId_type: {
          tenantId,
          type,
        },
      },
      update: {
        credentials: encryptJSON(mergedCredentials) as any,
        name: type.charAt(0).toUpperCase() + type.slice(1),
      },
      create: {
        tenantId,
        type,
        name: type.charAt(0).toUpperCase() + type.slice(1),
        credentials: encryptJSON(mergedCredentials) as any,
        isActive: true,
      },
    });

    return NextResponse.json({
      ...integration,
      credentials: maskCredentials(mergedCredentials),
    });
  } catch (error) {
    console.error('Error creating integration:', error);
    const details = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'Failed to create integration',
        ...(process.env.NODE_ENV !== 'production' ? { details } : {}),
      },
      { status: 500 }
    );
  }
}
