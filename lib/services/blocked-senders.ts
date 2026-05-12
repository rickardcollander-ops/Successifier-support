import { prisma } from '@/lib/db/client';

// Cache the blocklist for a few seconds so the per-message sync loop
// doesn't issue a separate query for every inbound email. Three seconds
// matches the UI poll cadence, which means a newly added block takes
// at most one cycle to take effect.
const CACHE_TTL_MS = 3_000;
const cache = new Map<string, { patterns: string[]; expiresAt: number }>();

export async function getBlockedPatterns(tenantId: string): Promise<string[]> {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.patterns;
  }
  const rows = await prisma.blockedSender.findMany({
    where: { tenantId },
    select: { pattern: true },
  });
  const patterns = rows.map((r) => r.pattern.toLowerCase().trim()).filter(Boolean);
  cache.set(tenantId, { patterns, expiresAt: Date.now() + CACHE_TTL_MS });
  return patterns;
}

// True when the email matches any of the configured block patterns.
// Patterns starting with "@" match any address in that domain; everything
// else is a full-address match. Case-insensitive.
export function isBlocked(email: string, patterns: string[]): boolean {
  if (!email || patterns.length === 0) return false;
  const lower = email.toLowerCase().trim();
  const domain = '@' + (lower.split('@')[1] || '');
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (pattern.startsWith('@')) {
      if (domain === pattern) return true;
    } else if (lower === pattern) {
      return true;
    }
  }
  return false;
}

export function invalidateBlocklistCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
