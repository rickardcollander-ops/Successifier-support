import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireApiAuth } from '@/lib/api-auth';
import { findScopedKnowledge } from '@/lib/db/scoped';

// List an article's edit history (newest first).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    // Tenant-scope the article before exposing its history.
    const article = await findScopedKnowledge(id);
    if (!article) return NextResponse.json({ error: 'Knowledge article not found' }, { status: 404 });

    const revisions = await prisma.knowledgeRevision.findMany({
      where: { articleId: article.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json({ revisions });
  } catch (error) {
    console.error('Error fetching revisions:', error);
    return NextResponse.json({ error: 'Failed to fetch revisions' }, { status: 500 });
  }
}

// Restore an article to a previous revision. The current state is snapshotted
// first (by the PATCH path would; here we snapshot inline) so the restore is
// itself reversible.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    const { revisionId } = await request.json();

    const [article, revision] = await Promise.all([
      findScopedKnowledge(id),
      prisma.knowledgeRevision.findUnique({ where: { id: revisionId } }),
    ]);

    if (!article || !revision || revision.articleId !== article.id) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    }

    // Snapshot current state before overwriting it.
    await prisma.knowledgeRevision.create({
      data: {
        articleId: article.id,
        title: article.title,
        content: article.content,
        excerpt: article.excerpt,
        editedBy: authResult.via === 'session' ? authResult.userEmail : 'api-key',
      },
    });

    const updated = await prisma.knowledgeBase.update({
      where: { id: article.id },
      data: { title: revision.title, content: revision.content, excerpt: revision.excerpt },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error restoring revision:', error);
    return NextResponse.json({ error: 'Failed to restore revision' }, { status: 500 });
  }
}
