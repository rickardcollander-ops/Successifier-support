import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenantId } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';
import { slugify } from '@/lib/services/kb-slug';

async function resolveTenantId(): Promise<string> {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error('Tenant not found');
  return tenantId;
}

// List help-center categories (admin view — includes non-public ones).
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await resolveTenantId();
    const categories = await prisma.knowledgeCategory.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return NextResponse.json({ categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}

// Create a help-center category.
export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await resolveTenantId();
    const { name, description, icon, sortOrder, isPublic } = await request.json();
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const category = await prisma.knowledgeCategory.create({
      data: {
        tenantId,
        name,
        slug: slugify(name) || 'kategori',
        description: description || null,
        icon: icon || null,
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
        isPublic: isPublic !== false,
      },
    });
    return NextResponse.json(category);
  } catch (error) {
    console.error('Error creating category:', error);
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}
