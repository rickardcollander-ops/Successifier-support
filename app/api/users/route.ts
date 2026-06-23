import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireSettingsAdmin } from '@/lib/api-auth';
import { isSettingsAdmin } from '@/lib/access';

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
      createdAt: true,
      _count: { select: { emailAccounts: true } },
    },
  });

  return NextResponse.json({
    currentUserEmail: authResult.userEmail.toLowerCase(),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      role: u.role,
      createdAt: u.createdAt,
      connectedInboxes: u._count.emailAccounts,
      isSettingsAdmin: isSettingsAdmin(u.email, u.role),
    })),
  });
}
