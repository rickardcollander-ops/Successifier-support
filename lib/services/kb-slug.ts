import { prisma } from '@/lib/db/client';

// Turn an article title into a URL-safe slug. Mirrors the SQL backfill in the
// migration (Swedish characters folded to ASCII).
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[éè]/g, 'e')
    .replace(/ü/g, 'u')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Produce a slug that is unique within a tenant. Falls back to a numeric
 * suffix when the base slug is already taken. `excludeId` lets an article keep
 * its own slug on update.
 */
export async function generateUniqueSlug(
  tenantId: string,
  title: string,
  excludeId?: string
): Promise<string> {
  const base = slugify(title) || 'artikel';
  let candidate = base;
  let n = 1;

  // Loop until we find a free slug. In practice this resolves in one or two
  // iterations; the unique index is the real guarantee.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await prisma.knowledgeBase.findFirst({
      where: { tenantId, slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}
