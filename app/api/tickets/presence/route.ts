import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// In-memory presence store (cleared on server restart, which is fine for presence)
const activeViewers = new Map<string, { userId: string; userName: string; userEmail: string; ticketId: string; lastSeen: number }>();

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

    const { ticketId } = await request.json();

    if (ticketId) {
      activeViewers.set(session.user.email, {
        userId: (session.user as any).id || session.user.email,
        userName: session.user.name || session.user.email.split('@')[0],
        userEmail: session.user.email,
        ticketId,
        lastSeen: Date.now(),
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

    const viewers: Record<string, Array<{ name: string; email: string; initials: string }>> = {};

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
      });
    }

    return NextResponse.json({ viewers });
  } catch (error) {
    console.error('Error fetching presence:', error);
    return NextResponse.json({ error: 'Failed to fetch presence' }, { status: 500 });
  }
}
