import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/client';
import { invalidateBlocklistCache } from '@/lib/services/blocked-senders';

async function resolveTenantId(request: NextRequest): Promise<string | null> {
  const hostname = request.nextUrl.hostname;
  const subdomain =
    hostname === 'localhost' || hostname === '127.0.0.1'
      ? 'doldadress'
      : hostname.split('.')[0];
  const tenant = await prisma.tenant.findUnique({ where: { subdomain } });
  return tenant?.id ?? null;
}

function normalizePattern(input: string): string {
  return input.trim().toLowerCase();
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = await resolveTenantId(request);
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  const rows = await prisma.blockedSender.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ blockedSenders: rows });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = await resolveTenantId(request);
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  const body = await request.json();
  const pattern = normalizePattern(body.pattern || '');
  if (!pattern) {
    return NextResponse.json({ error: 'pattern is required' }, { status: 400 });
  }
  // Accept either a full email ("foo@bar.com") or a domain pattern
  // starting with "@" ("@bar.com"). Reject obvious garbage so a typo
  // doesn't silently disable the inbox.
  const isDomain = pattern.startsWith('@') && pattern.length > 1 && pattern.includes('.');
  const isEmail = !pattern.startsWith('@') && /@.+\..+/.test(pattern);
  if (!isDomain && !isEmail) {
    return NextResponse.json(
      { error: 'pattern must be an email (foo@bar.com) or a domain (@bar.com)' },
      { status: 400 }
    );
  }

  try {
    const created = await prisma.blockedSender.create({
      data: {
        tenantId,
        pattern,
        reason: body.reason ?? null,
        createdBy: session.user.name || session.user.email || null,
      },
    });
    invalidateBlocklistCache(tenantId);
    return NextResponse.json(created);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Pattern already blocked' }, { status: 409 });
    }
    console.error('Error creating blocked sender:', error);
    return NextResponse.json({ error: 'Failed to add blocked sender' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = await resolveTenantId(request);
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  await prisma.blockedSender.deleteMany({ where: { id, tenantId } });
  invalidateBlocklistCache(tenantId);
  return NextResponse.json({ success: true });
}
