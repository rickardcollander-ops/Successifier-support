import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { getTenantId } from '@/lib/products/tenant';

async function resolveTenantId() {
  const tenantId = await getTenantId();
  if (!tenantId) {
    throw new Error(`Tenant '${product.key}' not found`);
  }
  return tenantId;
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = await resolveTenantId();

    const articles = await prisma.knowledgeBase.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ articles });
  } catch (error) {
    console.error('Error fetching knowledge base:', error);
    return NextResponse.json(
      { error: 'Failed to fetch knowledge base' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await resolveTenantId();
    const body = await request.json();
    const { title, content, category, tags, isActive } = body;

    if (!title || !content) {
      return NextResponse.json(
        { error: 'Title and content are required' },
        { status: 400 }
      );
    }

    const article = await prisma.knowledgeBase.create({
      data: {
        tenantId,
        title,
        content,
        category,
        tags: tags || [],
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    return NextResponse.json(article);
  } catch (error) {
    console.error('Error creating knowledge article:', error);
    return NextResponse.json(
      { error: 'Failed to create knowledge article' },
      { status: 500 }
    );
  }
}
