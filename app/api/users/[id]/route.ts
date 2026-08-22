import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireSettingsAdmin } from '@/lib/api-auth';
import { isSuperadmin } from '@/lib/access';

// Roles assignable from the user-admin UI. 'superadmin' is intentionally NOT
// assignable here — it's controlled by SUPERADMIN_EMAILS at the deployment
// level so it can't be granted (or revoked) by accident from the web.
const ASSIGNABLE_ROLES = ['agent', 'admin'] as const;

async function loadScopedUser(id: string) {
  const tenant = await getTenant();
  if (!tenant) return { tenant: null, user: null };
  const user = await prisma.user.findFirst({
    where: { id, tenantId: tenant.id },
  });
  return { tenant, user };
}

const SETTABLE_STATUSES = ['active', 'disabled'] as const;

// PATCH — change a user's role (agent ⇄ admin) and/or their status
// (active ⇄ disabled).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  const { id } = await params;
  const { user } = await loadScopedUser(id);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let body: { role?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data: { role?: string; status?: string } = {};

  if (body.role !== undefined) {
    const role = String(body.role);
    if (!ASSIGNABLE_ROLES.includes(role as (typeof ASSIGNABLE_ROLES)[number])) {
      return NextResponse.json({ error: 'Role must be agent or admin' }, { status: 400 });
    }
    data.role = role;
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!SETTABLE_STATUSES.includes(status as (typeof SETTABLE_STATUSES)[number])) {
      return NextResponse.json({ error: 'Status must be active or disabled' }, { status: 400 });
    }
    // Disabling yourself would lock you out of the very screen you'd need to
    // undo it — the same reasoning as the self-delete guard below.
    if (status === 'disabled' && user.email.toLowerCase() === authResult.userEmail.toLowerCase()) {
      return NextResponse.json({ error: 'Du kan inte stänga av ditt eget konto.' }, { status: 400 });
    }
    data.status = status;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Inget att uppdatera.' }, { status: 400 });
  }

  // Platform superadmins are controlled by SUPERADMIN_EMAILS at the deploy
  // level — their role can't be changed here. Product admins (e.g. Ida) are
  // regular, fully manageable accounts.
  if (isSuperadmin(user.email, user.role)) {
    return NextResponse.json(
      { error: 'Den här användaren är superadmin och styrs via deploy-inställningar, inte här.' },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: { id: true, role: true, status: true },
  });

  return NextResponse.json({ ok: true, ...updated });
}

// DELETE — remove a user (and, by cascade, their sessions and connected
// inboxes). Guards against removing yourself or a superadmin.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  const { id } = await params;
  const { user } = await loadScopedUser(id);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (user.email.toLowerCase() === authResult.userEmail.toLowerCase()) {
    return NextResponse.json({ error: 'Du kan inte ta bort ditt eget konto.' }, { status: 400 });
  }
  if (isSuperadmin(user.email, user.role)) {
    return NextResponse.json(
      { error: 'Superadmin-konton kan inte tas bort här.' },
      { status: 400 },
    );
  }

  await prisma.user.delete({ where: { id: user.id } });
  return NextResponse.json({ ok: true });
}
