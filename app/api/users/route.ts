import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireSettingsAdmin } from '@/lib/api-auth';
import { isSettingsAdmin, isSuperadmin } from '@/lib/access';
import { normalizeEmail } from '@/lib/auth-policy';
import { AuthEmailUnavailableError, sendInviteEmail } from '@/lib/services/auth-email';
import { getActiveTenantConfig } from '@/lib/products';

// GET — list the users that belong to this deployment's tenant. Settings
// admins only. We also flag which accounts are settings admins (by role or the
// email allowlist) and how many shared inboxes each has connected, so the
// admin UI can warn before removing someone who owns a synced mailbox.
export async function GET() {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ users: [] });

  const users = await prisma.user.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      status: true,
      invitedAt: true,
      invitedByEmail: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { emailAccounts: true } },
    },
  });

  return NextResponse.json({
    currentUserEmail: authResult.userEmail.toLowerCase(),
    users: users
      // Hide global superadmins (us, the platform operators) from the
      // user-admin list. Product admins (e.g. Ida) stay visible.
      .filter((u) => !isSuperadmin(u.email, u.role))
      .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      role: u.role,
      status: u.status,
      invitedAt: u.invitedAt,
      invitedByEmail: u.invitedByEmail,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      connectedInboxes: u._count.emailAccounts,
      isSettingsAdmin: isSettingsAdmin(u.email, u.role),
    })),
  });
}

const INVITABLE_ROLES = ['agent', 'admin'] as const;

// POST — invite someone into this tenant. Creating the User row IS the grant:
// lib/auth-policy.ts admits a provisioned account regardless of whether their
// domain is allowlisted, so this is how you give access to a consultant, a
// contractor, or anyone at a customer that runs invite-only (no auto-join).
//
// The invitation mail is a convenience, not the mechanism — access exists the
// moment the row does, so a mail that fails to send never leaves a half-granted
// account behind.
export async function POST(request: NextRequest) {
  const authResult = await requireSettingsAdmin();
  if (!authResult.ok) return authResult.response;

  const tenant = await getTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Ingen tenant kunde resolvas för den här värden.' }, { status: 400 });
  }

  let body: { email?: unknown; role?: unknown; sendEmail?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = normalizeEmail(String(body.email ?? ''));
  const role = String(body.role ?? 'agent');

  // Deliberately permissive shape check: the address only has to be routable
  // enough to mail, and the sign-in flow proves ownership anyway.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Ange en giltig e-postadress.' }, { status: 400 });
  }
  if (!INVITABLE_ROLES.includes(role as (typeof INVITABLE_ROLES)[number])) {
    return NextResponse.json({ error: 'Rollen måste vara agent eller admin.' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, tenantId: true, status: true, role: true },
  });

  // Platform superadmins are controlled by SUPERADMIN_EMAILS at the deploy
  // level. Without this a tenant admin could re-parent a superadmin's account
  // (or any tenant-less row) into their own tenant and rewrite its role — the
  // same guard PATCH and DELETE already carry.
  if (isSuperadmin(email, existing?.role)) {
    return NextResponse.json(
      { error: 'Superadmin-konton styrs via deploy-inställningar, inte här.' },
      { status: 400 },
    );
  }

  // An account that belongs to ANOTHER tenant is never silently moved — that
  // would hand one customer's agent to another customer.
  if (existing?.tenantId && existing.tenantId !== tenant.id) {
    return NextResponse.json(
      { error: 'Adressen tillhör redan en annan kund och kan inte bjudas in här.' },
      { status: 409 },
    );
  }
  // An account that is already up and running is a conflict; one that is
  // still pending is not — re-inviting resends the mail, which is the only
  // recovery when the first invitation failed to deliver.
  if (existing?.tenantId === tenant.id && existing.status === 'active') {
    return NextResponse.json(
      { error: 'Användaren finns redan i det här teamet.' },
      { status: 409 },
    );
  }

  // Re-inviting a disabled account reactivates it rather than creating a
  // duplicate — User.email is unique, and their ticket history should follow.
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      tenantId: tenant.id,
      role,
      status: 'invited',
      invitedAt: new Date(),
      invitedByEmail: authResult.userEmail.toLowerCase(),
    },
    create: {
      email,
      tenantId: tenant.id,
      role,
      status: 'invited',
      invitedAt: new Date(),
      invitedByEmail: authResult.userEmail.toLowerCase(),
    },
    select: { id: true, email: true, role: true, status: true, invitedAt: true, invitedByEmail: true },
  });

  let emailed = false;
  let emailError: string | null = null;
  if (body.sendEmail !== false) {
    try {
      const host = request.headers.get('host');
      const proto = request.headers.get('x-forwarded-proto') || 'https';
      await sendInviteEmail({
        to: email,
        signInUrl: `${proto}://${host}/auth/signin`,
        invitedByEmail: authResult.userEmail.toLowerCase(),
        tenantId: tenant.id,
        config: getActiveTenantConfig(),
      });
      emailed = true;
    } catch (error) {
      // The access grant already succeeded; report the delivery failure so
      // the admin can send the sign-in link by other means.
      emailError =
        error instanceof AuthEmailUnavailableError
          ? 'Kontot är skapat, men inget mejl kunde skickas: koppla kundens Resend-integration eller sätt AUTH_RESEND_KEY och AUTH_EMAIL_FROM.'
          : 'Kontot är skapat, men inbjudningsmejlet kunde inte skickas.';
      console.error('[users] invite email failed:', error);
    }
  }

  return NextResponse.json({ user, emailed, emailError }, { status: 201 });
}
