import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { getTenantId } from '@/lib/products/tenant';
import { encryptJSON, decryptJSON, isEncrypted } from '@/lib/crypto';

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
  try {
    const tenantId = await resolveTenantId();

    const integrations = await prisma.integration.findMany({
      where: { tenantId },
    });

    // Decrypt credentials before sending to client
    const decryptedIntegrations = integrations.map(integration => {
      try {
        const credentialsStr = typeof integration.credentials === 'string' 
          ? integration.credentials 
          : JSON.stringify(integration.credentials);
        
        // Check if already encrypted, if so decrypt
        const credentials = isEncrypted(credentialsStr)
          ? decryptJSON(credentialsStr)
          : integration.credentials;
        
        return {
          ...integration,
          credentials,
        };
      } catch (error) {
        console.error(`Failed to decrypt credentials for integration ${integration.id}:`, error);
        return integration; // Return as-is if decryption fails
      }
    });

    return NextResponse.json({ integrations: decryptedIntegrations });
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

    // Encrypt credentials before storing
    const encryptedCredentials = encryptJSON(credentials);

    const integration = await prisma.integration.upsert({
      where: {
        tenantId_type: {
          tenantId,
          type,
        },
      },
      update: {
        credentials: encryptedCredentials as any,
        name: type.charAt(0).toUpperCase() + type.slice(1),
      },
      create: {
        tenantId,
        type,
        name: type.charAt(0).toUpperCase() + type.slice(1),
        credentials: encryptedCredentials as any,
        isActive: true,
      },
    });

    // Decrypt for response
    const decryptedIntegration = {
      ...integration,
      credentials: decryptJSON(integration.credentials as any),
    };

    return NextResponse.json(decryptedIntegration);
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
