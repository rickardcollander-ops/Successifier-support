import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';

export async function validateApiKey(request: NextRequest): Promise<{ valid: boolean; tenantId?: string; error?: string }> {
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '');

  if (!apiKey) {
    return { valid: false, error: 'API key is required' };
  }

  try {
    const key = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: { tenant: true },
    });

    if (!key) {
      return { valid: false, error: 'Invalid API key' };
    }

    if (!key.isActive) {
      return { valid: false, error: 'API key is inactive' };
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    return { valid: true, tenantId: key.tenantId };
  } catch (error) {
    console.error('API key validation error:', error);
    return { valid: false, error: 'Internal server error' };
  }
}

export function generateApiKey(): string {
  const prefix = product.apiKeyPrefix;
  const randomPart = Array.from({ length: 32 }, () => 
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]
  ).join('');
  return `${prefix}_${randomPart}`;
}
