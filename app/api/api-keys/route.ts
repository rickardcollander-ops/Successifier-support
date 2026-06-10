import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { generateApiKey, hashApiKey, maskApiKey, requireSession } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const subdomain = product.key;

    const tenant = await prisma.tenant.findUnique({
      where: { subdomain },
      include: {
        apiKeys: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            maskedKey: true,
            lastUsedAt: true,
            isActive: true,
            createdAt: true,
          },
        },
      },
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    return NextResponse.json({ apiKeys: tenant.apiKeys });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const subdomain = product.key;

    const tenant = await prisma.tenant.findUnique({
      where: { subdomain },
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const { name } = await request.json();

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const key = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        tenantId: tenant.id,
        name,
        key: hashApiKey(key),
        maskedKey: maskApiKey(key),
      },
    });

    // The plaintext key is returned exactly once — only the hash is stored.
    return NextResponse.json({
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        key,
        maskedKey: apiKey.maskedKey,
        isActive: apiKey.isActive,
        createdAt: apiKey.createdAt,
        lastUsedAt: apiKey.lastUsedAt,
      },
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
  }
}
