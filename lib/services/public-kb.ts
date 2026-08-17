import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import type { PublicArticle } from '@/lib/types';

// Shared read layer for the PUBLIC help center. Everything customer-facing
// goes through here so the visibility and PII rules live in exactly one place:
//
//   * only isPublic = true AND status = 'published' articles are ever returned,
//   * auto-learned articles (which embed customer emails) are hard-excluded,
//   * only a narrow, safe subset of fields is exposed (never tenantId,
//     isActive, internal notes, etc).

export const AUTO_LEARNED_CATEGORY = 'Lärande från skickade svar';

// Reusable Prisma filter for "publicly visible article".
const publicWhere = (tenantId: string): Prisma.KnowledgeBaseWhereInput => ({
  tenantId,
  isPublic: true,
  status: 'published',
  category: { not: AUTO_LEARNED_CATEGORY },
});

const articleSelect = {
  slug: true,
  title: true,
  excerpt: true,
  tags: true,
  updatedAt: true,
  kbCategory: { select: { slug: true, name: true } },
} satisfies Prisma.KnowledgeBaseSelect;

type ArticleRow = {
  slug: string | null;
  title: string;
  excerpt: string | null;
  content?: string;
  tags: string[];
  updatedAt: Date;
  kbCategory: { slug: string; name: string } | null;
};

function toPublicArticle(row: ArticleRow): PublicArticle {
  return {
    slug: row.slug ?? '',
    title: row.title,
    excerpt: row.excerpt,
    ...(row.content !== undefined ? { content: row.content } : {}),
    category: row.kbCategory ? { slug: row.kbCategory.slug, name: row.kbCategory.name } : null,
    tags: row.tags,
    updatedAt: row.updatedAt,
  };
}

/** Public, browsable categories with a count of published articles. */
export async function getPublicCategories(tenantId: string) {
  const categories = await prisma.knowledgeCategory.findMany({
    where: { tenantId, isPublic: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { slug: true, name: true, description: true, icon: true },
  });

  const counts = await prisma.knowledgeBase.groupBy({
    by: ['categoryId'],
    where: publicWhere(tenantId),
    _count: { _all: true },
  });

  const idBySlug = await prisma.knowledgeCategory.findMany({
    where: { tenantId },
    select: { id: true, slug: true },
  });
  const countById = new Map(counts.map((c) => [c.categoryId, c._count._all]));

  return categories.map((c) => {
    const id = idBySlug.find((x) => x.slug === c.slug)?.id;
    return { ...c, articleCount: id ? countById.get(id) ?? 0 : 0 };
  });
}

/** List published articles, optionally filtered by category slug. */
export async function getPublicArticles(
  tenantId: string,
  { categorySlug, page = 1, pageSize = 20 }: { categorySlug?: string; page?: number; pageSize?: number } = {}
): Promise<{ articles: PublicArticle[]; total: number }> {
  const where: Prisma.KnowledgeBaseWhereInput = {
    ...publicWhere(tenantId),
    ...(categorySlug ? { kbCategory: { slug: categorySlug } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.knowledgeBase.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
      select: articleSelect,
      skip: (Math.max(page, 1) - 1) * pageSize,
      take: pageSize,
    }),
    prisma.knowledgeBase.count({ where }),
  ]);

  return { articles: rows.map(toPublicArticle), total };
}

/** A single published article by slug, including full markdown content. */
export async function getPublicArticleBySlug(
  tenantId: string,
  slug: string
): Promise<{ article: PublicArticle; related: PublicArticle[] } | null> {
  const row = await prisma.knowledgeBase.findFirst({
    where: { ...publicWhere(tenantId), slug },
    select: { ...articleSelect, content: true, relatedIds: true },
  });
  if (!row) return null;

  let related: PublicArticle[] = [];
  if (row.relatedIds.length > 0) {
    const relatedRows = await prisma.knowledgeBase.findMany({
      where: { ...publicWhere(tenantId), id: { in: row.relatedIds } },
      select: articleSelect,
      take: 6,
    });
    related = relatedRows.map(toPublicArticle);
  }

  return { article: toPublicArticle(row), related };
}

/** Full-text search over published articles using Postgres' Swedish config. */
export async function searchPublicArticles(
  tenantId: string,
  query: string
): Promise<PublicArticle[]> {
  const q = query.trim();
  if (!q) return [];

  const rows = await prisma.$queryRaw<
    Array<{
      slug: string | null;
      title: string;
      excerpt: string | null;
      tags: string[];
      updatedAt: Date;
      categorySlug: string | null;
      categoryName: string | null;
    }>
  >(Prisma.sql`
    SELECT kb."slug", kb."title", kb."excerpt", kb."tags", kb."updatedAt",
           cat."slug" AS "categorySlug", cat."name" AS "categoryName"
    FROM "KnowledgeBase" kb
    LEFT JOIN "KnowledgeCategory" cat ON cat."id" = kb."categoryId"
    WHERE kb."tenantId" = ${tenantId}
      AND kb."isPublic" = true
      AND kb."status" = 'published'
      AND (kb."category" IS DISTINCT FROM ${AUTO_LEARNED_CATEGORY})
      AND kb."searchVector" @@ websearch_to_tsquery('swedish', ${q})
    ORDER BY ts_rank(kb."searchVector", websearch_to_tsquery('swedish', ${q})) DESC
    LIMIT 20
  `);

  return rows.map((r) =>
    toPublicArticle({
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      tags: r.tags,
      updatedAt: r.updatedAt,
      kbCategory: r.categorySlug && r.categoryName ? { slug: r.categorySlug, name: r.categoryName } : null,
    })
  );
}

/**
 * Fetch full content for a set of public slugs, in the order requested.
 * Used to ground the help-center chatbot: only published, public, non
 * auto-learned articles are ever returned, so the bot can never cite
 * internal or PII-bearing content.
 */
export async function getPublicArticleContentsBySlugs(
  tenantId: string,
  slugs: string[]
): Promise<Array<{ slug: string; title: string; content: string }>> {
  if (slugs.length === 0) return [];
  const rows = await prisma.knowledgeBase.findMany({
    where: { ...publicWhere(tenantId), slug: { in: slugs } },
    select: { slug: true, title: true, content: true },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return slugs
    .map((s) => bySlug.get(s))
    .filter((r): r is { slug: string; title: string; content: string } => !!r && !!r.slug)
    .map((r) => ({ slug: r.slug as string, title: r.title, content: r.content }));
}

/** Resolve the article id behind a public slug (for view counting / feedback). */
export async function getPublicArticleId(tenantId: string, slug: string): Promise<string | null> {
  const row = await prisma.knowledgeBase.findFirst({
    where: { ...publicWhere(tenantId), slug },
    select: { id: true },
  });
  return row?.id ?? null;
}

// form_resolved / form_escalated come from the AI contact form: the customer
// said the instant answer solved it, or sent the question on as a ticket.
// Together they measure how many tickets the form deflects.
type KbEventType = 'view' | 'search' | 'helpful' | 'unhelpful' | 'form_resolved' | 'form_escalated';

/** Append-only analytics event. Never throws into the request path. */
export async function logKbEvent(
  tenantId: string,
  event: { type: KbEventType; articleId?: string; query?: string; resultsCount?: number }
): Promise<void> {
  try {
    await prisma.knowledgeEvent.create({
      data: {
        tenantId,
        type: event.type,
        articleId: event.articleId ?? null,
        query: event.query ?? null,
        resultsCount: event.resultsCount ?? null,
      },
    });
  } catch (error) {
    console.error('[KB] Failed to log event:', error);
  }
}

/** Increment the denormalized view counter for an article. Best-effort. */
export async function incrementViewCount(articleId: string): Promise<void> {
  try {
    await prisma.knowledgeBase.update({
      where: { id: articleId },
      data: { viewCount: { increment: 1 } },
    });
  } catch (error) {
    console.error('[KB] Failed to increment view count:', error);
  }
}

// --- CORS ---------------------------------------------------------------
// Public read endpoints are embeddable from the product's own website. We
// reflect the request origin when it belongs to an allowed product domain,
// and otherwise fall back to '*' (the content is public and read-only).

const allowedHostSuffixes = () => [product.apiBaseDomain, ...product.allowedDomains];

export function corsHeaders(origin: string | null): Record<string, string> {
  let allowOrigin = '*';
  if (origin) {
    try {
      const host = new URL(origin).hostname;
      if (allowedHostSuffixes().some((d) => host === d || host.endsWith(`.${d}`))) {
        allowOrigin = origin;
      }
    } catch {
      /* malformed Origin header — keep wildcard */
    }
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=60, s-maxage=300',
  };
}
