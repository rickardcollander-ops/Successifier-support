import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { getTenantId } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';
import { generateUniqueSlug } from '@/lib/services/kb-slug';

const VALID_STATUSES = new Set(['draft', 'review', 'published']);

async function resolveTenantId() {
  const tenantId = await getTenantId();
  if (!tenantId) {
    throw new Error(`Tenant '${product.key}' not found`);
  }
  return tenantId;
}

// Auto-lärda artiklar ("Lärda från mail") behålls bara i 30 dagar
const AUTO_LEARNED_CATEGORY = 'Lärande från skickade svar';
const AUTO_LEARNED_RETENTION_DAYS = 30;

async function pruneExpiredLearnedArticles(tenantId: string) {
  const cutoff = new Date(Date.now() - AUTO_LEARNED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.knowledgeBase.deleteMany({
    where: {
      tenantId,
      category: AUTO_LEARNED_CATEGORY,
      createdAt: { lt: cutoff },
    },
  });
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await resolveTenantId();

    // Rensa bort lärda-från-mail-artiklar äldre än 30 dagar innan vi hämtar
    await pruneExpiredLearnedArticles(tenantId);

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
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await resolveTenantId();
    const body = await request.json();
    const { title, content, category, tags, isActive, isPublic, status, excerpt, categoryId, relatedIds, sortOrder, slug } = body;

    if (!title || !content) {
      return NextResponse.json(
        { error: 'Title and content are required' },
        { status: 400 }
      );
    }

    // A public article must have a slug; generate one when not supplied.
    const finalSlug = await generateUniqueSlug(tenantId, slug || title);

    const article = await prisma.knowledgeBase.create({
      data: {
        tenantId,
        title,
        content,
        category,
        tags: tags || [],
        isActive: isActive !== undefined ? isActive : true,
        slug: finalSlug,
        isPublic: isPublic === true,
        status: VALID_STATUSES.has(status) ? status : 'draft',
        excerpt: excerpt || null,
        categoryId: categoryId || null,
        relatedIds: Array.isArray(relatedIds) ? relatedIds : [],
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
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
