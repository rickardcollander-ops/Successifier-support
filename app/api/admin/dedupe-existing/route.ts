import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireSuperadmin } from '@/lib/api-auth';

// Dedup window for existing cleanup. Matches the window enforced for new
// tickets in lib/services/deduplicator.ts so the retroactive cleanup uses
// the same definition of "duplicate" as the runtime guard.
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

function normalizeSubject(subject: string): string {
  return subject.replace(/^(Re|Sv|Fwd|Fw):\s*/i, '').trim().toLowerCase();
}

// Scan for groups of tickets with the same (normalized subject, customer
// email) created within the dedup window. Keep the oldest; mark the rest
// as status='duplicate' so they show up under the Dubletter tab instead
// of being silently deleted.
export async function POST(request: NextRequest) {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  const tenant = await getTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      tenantId: tenant.id,
      status: { notIn: ['archived', 'duplicate'] },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      customerEmail: true,
      subject: true,
      createdAt: true,
    },
  });

  // Bucket by (email, normalized subject). Within each bucket, walk in
  // time order and group any run of tickets created within the window
  // of the anchor ticket.
  const buckets = new Map<string, typeof tickets>();
  for (const t of tickets) {
    const key = `${t.customerEmail.toLowerCase()}|${normalizeSubject(t.subject)}`;
    const list = buckets.get(key) ?? [];
    list.push(t);
    buckets.set(key, list);
  }

  const toMark: Array<{ id: string; keptId: string }> = [];

  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    let anchor = list[0];
    for (let i = 1; i < list.length; i += 1) {
      const candidate = list[i];
      const delta = candidate.createdAt.getTime() - anchor.createdAt.getTime();
      if (delta <= DUPLICATE_WINDOW_MS) {
        toMark.push({ id: candidate.id, keptId: anchor.id });
      } else {
        // Outside the window — treat this candidate as a fresh anchor
        // for the remainder of the bucket.
        anchor = candidate;
      }
    }
  }

  if (toMark.length === 0) {
    return NextResponse.json({
      success: true,
      scanned: tickets.length,
      markedAsDuplicate: 0,
      groups: 0,
    });
  }

  const result = await prisma.ticket.updateMany({
    where: { id: { in: toMark.map((m) => m.id) } },
    data: { status: 'duplicate' },
  });

  const uniqueKeptIds = new Set(toMark.map((m) => m.keptId));

  return NextResponse.json({
    success: true,
    scanned: tickets.length,
    markedAsDuplicate: result.count,
    groups: uniqueKeptIds.size,
    details: toMark.slice(0, 50),
  });
}
