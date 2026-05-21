import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { auth } from '@/lib/auth';
import { google } from 'googleapis';

// One-time migration: correct the [Följdmail <timestamp>] markers in
// originalMessage for all existing tickets. The timestamp used to be
// set to new Date() at sync time rather than the actual email arrival
// time (Gmail internalDate). This endpoint looks up each Gmail ID
// stored in the message body and patches the timestamps in-place.
//
// POST /api/admin/fix-followup-timestamps
// Optional body: { dryRun: true } to preview changes without writing.

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const dryRun = body.dryRun === true;

  const hostname = request.nextUrl.hostname;
  const subdomain =
    hostname === 'localhost' || hostname === '127.0.0.1'
      ? 'doldadress'
      : hostname.split('.')[0];

  const tenant = await prisma.tenant.findUnique({ where: { subdomain } });
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  // Load all email accounts so we can try each one when looking up a Gmail ID.
  const emailAccounts = await prisma.emailAccount.findMany({
    where: { isActive: true },
  });

  if (emailAccounts.length === 0) {
    return NextResponse.json({ error: 'No active email accounts found' }, { status: 400 });
  }

  // Build a map of inbox address → oauth client for quick lookup.
  const accountByEmail: Record<string, any> = {};
  for (const acc of emailAccounts) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    oauth2Client.setCredentials({
      access_token: acc.accessToken,
      refresh_token: acc.refreshToken,
    });
    // Persist token refreshes silently.
    oauth2Client.on('tokens', async (tokens) => {
      try {
        const updateData: { accessToken?: string; refreshToken?: string } = {};
        if (tokens.access_token) updateData.accessToken = tokens.access_token;
        if (tokens.refresh_token) updateData.refreshToken = tokens.refresh_token;
        if (Object.keys(updateData).length > 0) {
          await prisma.emailAccount.update({ where: { id: acc.id }, data: updateData });
        }
      } catch {}
    });
    accountByEmail[acc.email] = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  // Tickets that have at least one [Följdmail] section.
  const tickets = await prisma.ticket.findMany({
    where: {
      tenantId: tenant.id,
      originalMessage: { contains: '[Följdmail ' },
    },
    select: { id: true, originalMessage: true },
  });

  const results: Array<{ ticketId: string; changed: boolean; patches: string[]; error?: string }> = [];

  for (const ticket of tickets) {
    try {
      const patches: string[] = [];
      let updated = ticket.originalMessage;

      // Find every [Följdmail <timestamp>] section. The separator format is:
      //   \n\n---\n[Följdmail <timestamp>]\n[Gmail ID: <id>]\n...
      const sectionRegex = /\[Följdmail ([^\]]+)\]\n(?:\[Gmail ID: ([^\]]+)\]\n)?(?:\[Gmail ID: [^\]]+\]\n)?(?:\[Inbox account: ([^\]]+)\]\n)?/g;
      let match: RegExpExecArray | null;

      while ((match = sectionRegex.exec(ticket.originalMessage)) !== null) {
        const currentTimestamp = match[1];
        const gmailId = match[2];
        const inboxAccount = match[3]?.trim();

        if (!gmailId) continue;

        // Try the matching inbox account first, then fall back to all accounts.
        const orderedAccounts = inboxAccount && accountByEmail[inboxAccount]
          ? [accountByEmail[inboxAccount], ...Object.entries(accountByEmail).filter(([e]) => e !== inboxAccount).map(([, v]) => v)]
          : Object.values(accountByEmail);

        let actualDate: Date | null = null;
        for (const gmailClient of orderedAccounts) {
          try {
            const msg = await (gmailClient as any).users.messages.get({
              userId: 'me',
              id: gmailId,
              format: 'minimal',
            });
            const internalMs = msg.data.internalDate ? Number(msg.data.internalDate) : NaN;
            if (Number.isFinite(internalMs)) {
              actualDate = new Date(internalMs);
              break;
            }
          } catch {
            // Message not found in this account — try next.
          }
        }

        if (!actualDate) continue;

        const actualTimestamp = actualDate.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
        if (actualTimestamp === currentTimestamp) continue;

        // Replace just this one occurrence of the wrong timestamp.
        const oldMarker = `[Följdmail ${currentTimestamp}]`;
        const newMarker = `[Följdmail ${actualTimestamp}]`;
        updated = updated.replace(oldMarker, newMarker);
        patches.push(`${gmailId}: "${currentTimestamp}" → "${actualTimestamp}"`);
      }

      const changed = patches.length > 0;
      if (changed && !dryRun) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { originalMessage: updated },
        });
      }
      results.push({ ticketId: ticket.id, changed, patches });
    } catch (err: any) {
      results.push({ ticketId: ticket.id, changed: false, patches: [], error: err?.message });
    }
  }

  const fixed = results.filter((r) => r.changed).length;
  return NextResponse.json({
    dryRun,
    totalTickets: tickets.length,
    ticketsFixed: fixed,
    results,
  });
}
