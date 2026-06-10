import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireApiAuth } from '@/lib/api-auth';
import { generateUniqueSlug } from '@/lib/services/kb-slug';
import { AUTO_LEARNED_CATEGORY } from '@/lib/services/public-kb';

const VALID_STATUSES = new Set(['draft', 'review', 'published']);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const { id } = await params;

    const existing = await prisma.knowledgeBase.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};

    // Whitelist the fields a client may update.
    for (const field of ['title', 'content', 'category', 'tags', 'isActive', 'excerpt', 'categoryId', 'relatedIds', 'sortOrder'] as const) {
      if (body[field] !== undefined) data[field] = body[field];
    }

    if (body.status !== undefined && VALID_STATUSES.has(body.status)) {
      data.status = body.status;
    }

    // Auto-learned articles embed customer PII and may NEVER be made public,
    // regardless of what the client sends.
    if (body.isPublic !== undefined) {
      data.isPublic = body.isPublic === true && existing.category !== AUTO_LEARNED_CATEGORY;
    }

    // Re-slug when the slug is explicitly changed or a title change leaves the
    // article without one.
    if (typeof body.slug === 'string' && body.slug.trim()) {
      data.slug = await generateUniqueSlug(existing.tenantId, body.slug, id);
    } else if (!existing.slug && typeof body.title === 'string') {
      data.slug = await generateUniqueSlug(existing.tenantId, body.title, id);
    }

    // Drop the "AI Draft:" prefix once an article is activated for the AI.
    if (data.isActive === true) {
      const rawTitle = typeof data.title === 'string' ? data.title : existing.title;
      if (rawTitle) {
        data.title = rawTitle.replace(/^\s*AI\s*Draft:\s*/i, '').trim();
      }
    }

    // Snapshot the pre-edit state so changes can be audited and restored.
    await prisma.knowledgeRevision.create({
      data: {
        articleId: id,
        title: existing.title,
        content: existing.content,
        excerpt: existing.excerpt,
        editedBy: authResult.via === 'session' ? authResult.userEmail : 'api-key',
      },
    });

    const article = await prisma.knowledgeBase.update({ where: { id }, data });

    return NextResponse.json(article);
  } catch (error) {
    console.error('Error updating knowledge article:', error);
    return NextResponse.json(
      { error: 'Failed to update knowledge article' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;

    await prisma.knowledgeBase.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting knowledge article:', error);
    return NextResponse.json(
      { error: 'Failed to delete knowledge article' },
      { status: 500 }
    );
  }
}
