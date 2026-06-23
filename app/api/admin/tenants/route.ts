import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { requireSuperadmin } from '@/lib/api-auth';

// Cross-tenant administration. The superadmin role is granted globally
// (see SUPERADMIN_EMAILS in lib/auth.ts), so these endpoints intentionally
// operate across ALL tenants rather than the deployment's pinned tenant —
// they are the place to create new tenants and keep an eye on existing ones.

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

/** List every tenant with a few headline counts. */
export async function GET() {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      subdomain: true,
      name: true,
      createdAt: true,
      _count: {
        select: {
          users: true,
          tickets: true,
          knowledge: true,
          agents: true,
        },
      },
    },
  });

  return NextResponse.json({ tenants });
}

/** Create a new tenant. */
export async function POST(request: NextRequest) {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  let body: { subdomain?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const subdomain = String(body.subdomain ?? '').trim().toLowerCase();
  const name = String(body.name ?? '').trim();

  if (!name) {
    return NextResponse.json({ error: 'Namn krävs' }, { status: 400 });
  }
  if (!SUBDOMAIN_RE.test(subdomain)) {
    return NextResponse.json(
      {
        error:
          'Subdomän måste vara 2–32 tecken: a–z, 0–9 och bindestreck (ej i början/slutet).',
      },
      { status: 400 },
    );
  }

  const existing = await prisma.tenant.findUnique({ where: { subdomain } });
  if (existing) {
    return NextResponse.json(
      { error: `Subdomänen "${subdomain}" är redan upptagen.` },
      { status: 409 },
    );
  }

  const tenant = await prisma.tenant.create({
    data: { subdomain, name },
    select: { id: true, subdomain: true, name: true, createdAt: true },
  });

  return NextResponse.json({ tenant }, { status: 201 });
}
