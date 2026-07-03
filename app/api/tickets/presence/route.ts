import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/client';

// In-memory presence store (cleared on server restart, which is fine for presence)
const activeViewers = new Map<string, { userId: string; userName: string; userEmail: string; ticketId: string; lastSeen: number; typing: boolean; draft: string }>();

// The live draft preview is capped so a pasted novel doesn't bloat every
// heartbeat and presence poll for the whole team.
const MAX_DRAFT_LENGTH = 4000;

// Heartbeats arrive every ~5s. If two consecutive beats from the same user on
// the same ticket fall within this window we credit the elapsed gap as active
// work time and persist it on the ticket; a longer gap means they were away
// (other ticket, idle, tab closed) and isn't counted. The cap also stops a
// single near-miss beat from inflating the total.
const ACTIVE_WINDOW_MS = 15000;

// Clean up stale entries older than 15 seconds
function cleanupStale() {
  const now = Date.now();
  for (const [key, entry] of activeViewers.entries()) {
    if (now - entry.lastSeen > 15000) {
      activeViewers.delete(key);
    }
  }
}

// POST: report that current user is viewing a ticket
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { ticketId, typing, draft } = await request.json();

    if (ticketId) {
      const now = Date.now();
      // Credit the gap since this user's previous beat as active work time,
      // but only if they were on the SAME ticket and within the active window.
      const prev = activeViewers.get(session.user.email);
      if (prev && prev.ticketId === ticketId) {
        const delta = now - prev.lastSeen;
        if (delta > 0 && delta <= ACTIVE_WINDOW_MS) {
          const seconds = Math.round(delta / 1000);
          if (seconds > 0) {
            // Raw increment so we don't bump updatedAt and reorder the list.
            prisma.$executeRaw`
              UPDATE "Ticket"
              SET "activeWorkSeconds" = "activeWorkSeconds" + ${seconds}
              WHERE id = ${ticketId}
            `.catch((e) => console.error('Failed to accrue active work time:', e));
          }
        }
      }
      activeViewers.set(session.user.email, {
        userId: (session.user as any).id || session.user.email,
        userName: session.user.name || session.user.email.split('@')[0],
        userEmail: session.user.email,
        ticketId,
        lastSeen: now,
        typing: Boolean(typing),
        // Only carry the draft while actively composing — once typing stops
        // the preview disappears for colleagues rather than lingering.
        draft: typing && typeof draft === 'string' ? draft.slice(0, MAX_DRAFT_LENGTH) : '',
      });
    } else {
      // User deselected ticket
      activeViewers.delete(session.user.email);
    }

    cleanupStale();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating presence:', error);
    return NextResponse.json({ error: 'Failed to update presence' }, { status: 500 });
  }
}

// GET: get all active viewers (excluding the requesting user)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    cleanupStale();

    const viewers: Record<string, Array<{ name: string; email: string; initials: string; typing: boolean; draft: string }>> = {};

    for (const [email, entry] of activeViewers.entries()) {
      if (email === session.user.email) continue; // exclude self

      if (!viewers[entry.ticketId]) {
        viewers[entry.ticketId] = [];
      }

      const nameParts = entry.userName.split(' ');
      const initials = nameParts.length >= 2
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
        : entry.userName.substring(0, 2).toUpperCase();

      viewers[entry.ticketId].push({
        name: entry.userName,
        email: entry.userEmail,
        initials,
        typing: Boolean(entry.typing),
        draft: entry.typing ? entry.draft || '' : '',
      });
    }

    return NextResponse.json({ viewers });
  } catch (error) {
    console.error('Error fetching presence:', error);
    return NextResponse.json({ error: 'Failed to fetch presence' }, { status: 500 });
  }
}
