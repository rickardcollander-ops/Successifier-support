import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';
import { getTenant } from '@/lib/products/tenant';
import { requireApiAuth, requireSettingsAdmin } from '@/lib/api-auth';
import { BUILTIN_TAB_KEYS, type StoredTab } from '@/lib/inbox-tabs';

// GET — return the tenant's stored inbox-tab config. Readable by any signed-in
// agent (the inbox needs it to render its folders). An empty list means "use
// the built-in defaults", which the client resolves.
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ tabs: [] });

  const rows = await prisma.inboxTab.findMany({
    where: { tenantId: tenant.id },
    orderBy: { order: 'asc' },
  });

  const tabs: StoredTab[] = rows.map((r) => ({
    key: r.key,
    label: r.label,
    order: r.order,
    visible: r.visible,
    isCustom: r.isCustom,
    rules: (r.rules as StoredTab['rules']) ?? null,
  }));

  return NextResponse.json({ tabs });
}

// PUT — replace the whole tab config for the tenant. Settings admins only.
// We store the complete ordered list the admin built (built-ins + customs),
// so the read path can return it verbatim.
export async function PUT(request: NextRequest) {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  let body: { tabs?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.tabs)) {
    return NextResponse.json({ error: 'tabs must be an array' }, { status: 400 });
  }

  const builtinKeys = new Set<string>(BUILTIN_TAB_KEYS);
  const seen = new Set<string>();
  const rows: Array<Omit<Prisma.InboxTabCreateManyInput, 'tenantId'>> = [];

  for (const [i, raw] of (body.tabs as any[]).entries()) {
    const key = String(raw?.key || '').trim();
    const label = String(raw?.label || '').trim();
    const isCustom = Boolean(raw?.isCustom);
    if (!key || !label) {
      return NextResponse.json({ error: 'Each tab needs a key and a label' }, { status: 400 });
    }
    if (seen.has(key)) {
      return NextResponse.json({ error: `Duplicate tab key: ${key}` }, { status: 400 });
    }
    seen.add(key);
    // A non-custom tab must reference a known built-in folder.
    if (!isCustom && !builtinKeys.has(key)) {
      return NextResponse.json({ error: `Unknown built-in tab: ${key}` }, { status: 400 });
    }
    rows.push({
      key,
      label,
      order: Number.isFinite(raw?.order) ? Number(raw.order) : i,
      visible: raw?.visible !== false,
      isCustom,
      rules: isCustom ? ((raw?.rules ?? null) as Prisma.InputJsonValue) : undefined,
    });
  }

  await prisma.$transaction([
    prisma.inboxTab.deleteMany({ where: { tenantId: tenant.id } }),
    prisma.inboxTab.createMany({
      data: rows.map((r) => ({ ...r, tenantId: tenant.id })),
    }),
  ]);

  return NextResponse.json({ ok: true, count: rows.length });
}
