import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireApiAuth } from '@/lib/api-auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const { id } = await params;

    const data = { ...body };

    if (data.isActive === true) {
      const existing = await prisma.knowledgeBase.findUnique({
        where: { id },
        select: { title: true },
      });

      const rawTitle = typeof data.title === 'string' ? data.title : existing?.title;
      if (rawTitle) {
        data.title = rawTitle.replace(/^\s*AI\s*Draft:\s*/i, '').trim();
      }
    }

    const article = await prisma.knowledgeBase.update({
      where: { id },
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
