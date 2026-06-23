import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireSettingsAdmin } from '@/lib/api-auth';
import { settingsAdminEmails } from '@/lib/access';

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

// PATCH — change a user's role (agent ⇄ admin).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  const { id } = await params;
  const { user } = await loadScopedUser(id);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let body: { role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const role = String(body.role || '');
  if (!ASSIGNABLE_ROLES.includes(role as (typeof ASSIGNABLE_ROLES)[number])) {
    return NextResponse.json({ error: 'Role must be agent or admin' }, { status: 400 });
  }

  // Email-allowlisted superadmins keep their access regardless of the stored
  // role; don't let the UI imply it can demote them.
  if (settingsAdminEmails().includes(user.email.toLowerCase())) {
    return NextResponse.json(
      { error: 'Den här användaren är superadmin och styrs via deploy-inställningar, inte här.' },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role },
    select: { id: true, role: true },
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
  if (settingsAdminEmails().includes(user.email.toLowerCase())) {
    return NextResponse.json(
      { error: 'Superadmin-konton kan inte tas bort här.' },
      { status: 400 },
    );
  }

  await prisma.user.delete({ where: { id: user.id } });
  return NextResponse.json({ ok: true });
}
