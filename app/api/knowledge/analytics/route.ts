import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenantId } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';

// Aggregated help-center usage analytics for the agent dashboard.
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await getTenantId();
    if (!tenantId) return NextResponse.json({ topArticles: [], topSearches: [], noResultSearches: [], feedback: [] });

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [viewRows, searchRows, noResultRows, feedbackRows] = await Promise.all([
      prisma.knowledgeEvent.groupBy({
        by: ['articleId'],
        where: { tenantId, type: 'view', articleId: { not: null }, createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { articleId: 'desc' } },
        take: 10,
      }),
      prisma.knowledgeEvent.groupBy({
        by: ['query'],
        where: { tenantId, type: 'search', query: { not: null }, createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { query: 'desc' } },
        take: 15,
      }),
      prisma.knowledgeEvent.groupBy({
        by: ['query'],
        where: { tenantId, type: 'search', resultsCount: 0, query: { not: null }, createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { query: 'desc' } },
        take: 15,
      }),
      prisma.knowledgeEvent.groupBy({
        by: ['articleId', 'type'],
        where: { tenantId, type: { in: ['helpful', 'unhelpful'] }, articleId: { not: null }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    // Resolve article titles/slugs for the view + feedback aggregates.
    const articleIds = Array.from(
      new Set([...viewRows, ...feedbackRows].map((r) => r.articleId).filter((x): x is string => Boolean(x)))
    );
    const articles = await prisma.knowledgeBase.findMany({
      where: { id: { in: articleIds } },
      select: { id: true, title: true, slug: true },
    });
    const byId = new Map(articles.map((a) => [a.id, a]));

    const topArticles = viewRows.map((r) => ({
      articleId: r.articleId,
      title: byId.get(r.articleId!)?.title ?? '(borttagen)',
      slug: byId.get(r.articleId!)?.slug ?? null,
      views: r._count._all,
    }));

    // Fold helpful/unhelpful counts into a per-article ratio.
    const fb = new Map<string, { helpful: number; unhelpful: number }>();
    for (const row of feedbackRows) {
      const key = row.articleId!;
      const entry = fb.get(key) ?? { helpful: 0, unhelpful: 0 };
      if (row.type === 'helpful') entry.helpful += row._count._all;
      else entry.unhelpful += row._count._all;
      fb.set(key, entry);
    }
    const feedback = Array.from(fb.entries()).map(([articleId, counts]) => {
      const total = counts.helpful + counts.unhelpful;
      return {
        articleId,
        title: byId.get(articleId)?.title ?? '(borttagen)',
        slug: byId.get(articleId)?.slug ?? null,
        helpful: counts.helpful,
        unhelpful: counts.unhelpful,
        ratio: total > 0 ? Math.round((counts.helpful / total) * 100) : null,
      };
    });

    return NextResponse.json({
      days,
      topArticles,
      topSearches: searchRows.map((r) => ({ query: r.query, count: r._count._all })),
      noResultSearches: noResultRows.map((r) => ({ query: r.query, count: r._count._all })),
      feedback,
    });
  } catch (error) {
    console.error('Error fetching KB analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
