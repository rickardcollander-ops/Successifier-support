import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireApiAuth } from '@/lib/api-auth';
import { findScopedKnowledge } from '@/lib/db/scoped';

// Client-settable fields. tenantId and timestamps are server-managed.
const PATCHABLE_FIELDS = ['title', 'content', 'category', 'tags', 'isActive'] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const { id } = await params;

    const existing = await findScopedKnowledge(id);
    if (!existing) {
      return NextResponse.json({ error: 'Knowledge article not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    for (const field of PATCHABLE_FIELDS) {
      if (field in body) data[field] = body[field];
    }

    if (data.isActive === true) {
      const rawTitle = typeof data.title === 'string' ? data.title : existing.title;
      if (rawTitle) {
        data.title = rawTitle.replace(/^\s*AI\s*Draft:\s*/i, '').trim();
      }
    }

    const article = await prisma.knowledgeBase.update({
      where: { id: existing.id },
      data,
    });

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

    const existing = await findScopedKnowledge(id);
    if (!existing) {
      return NextResponse.json({ error: 'Knowledge article not found' }, { status: 404 });
    }

    await prisma.knowledgeBase.delete({
      where: { id: existing.id },
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
