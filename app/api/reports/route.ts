import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { AGENTS } from '@/lib/constants';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    
    // Get tenant from subdomain
    const hostname = request.nextUrl.hostname;
    const subdomain =
      hostname === 'localhost' || hostname === '127.0.0.1'
        ? 'doldadress'
        : hostname.split('.')[0];
    
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain },
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Calculate date range. We align startDate to midnight so the activity
    // chart buckets (one per calendar day) stay consistent with the ticket
    // filter — otherwise tickets created between midnight and the current
    // time on the oldest day would be counted in totalTickets but missing
    // from the chart, which made the chart look broken. The "1d" range
    // is special-cased to a rolling-24h window: a single bar wouldn't
    // tell anyone anything, so the chart hides for that range.
    const now = new Date();
    const daysAgo =
      range === '1d' ? 1 :
      range === '7d' ? 7 :
      range === '30d' ? 30 :
      90;
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDate = range === '1d'
      ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
      : new Date(todayStart.getTime() - (daysAgo - 1) * 24 * 60 * 60 * 1000);

    // Get all tickets in range
    const tickets = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        createdAt: {
          gte: startDate,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Calculate metrics
    const totalTickets = tickets.length;

    // Tickets by status
    const ticketsByStatus = tickets.reduce((acc, ticket) => {
      acc[ticket.status] = (acc[ticket.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Tickets by priority
    const ticketsByPriority = tickets.reduce((acc, ticket) => {
      acc[ticket.priority] = (acc[ticket.priority] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Resolved today
    const resolvedToday = tickets.filter(
      (t) => (t.status === 'sent' || t.status === 'closed') &&
      new Date(t.updatedAt) >= todayStart
    ).length;

    // Pending tickets (new or in_progress)
    const pendingTickets = tickets.filter(
      (t) => t.status === 'new' || t.status === 'in_progress'
    ).length;

    // Average response time (in hours). Only count tickets where the
    // agent actually clicked Send (sentAt is set) — earlier we used
    // updatedAt - createdAt which moves every time anything on the
    // ticket changes (AI suggestion arriving, assignment change, etc.)
    // and inflated the number compared to actual time-to-reply.
    const respondedTickets = tickets.filter((t) => t.sentAt);
    const avgResponseTime = respondedTickets.length > 0
      ? respondedTickets.reduce((sum, ticket) => {
          const created = new Date(ticket.createdAt).getTime();
          const sent = new Date(ticket.sentAt!).getTime();
          return sum + (sent - created) / (1000 * 60 * 60); // Convert to hours
        }, 0) / respondedTickets.length
      : 0;

    // Recent activity (tickets per day). Using calendar-day buckets anchored
    // on todayStart so every ticket in totalTickets maps to exactly one bar.
    const recentActivity = [];
    for (let i = daysAgo - 1; i >= 0; i--) {
      const dayStart = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const count = tickets.filter(
        (t) => new Date(t.createdAt) >= dayStart && new Date(t.createdAt) < dayEnd
      ).length;

      recentActivity.push({
        date: dayStart.toISOString().split('T')[0],
        count,
      });
    }

    // Per-user statistics: count tickets the user was assigned to AND
    // count tickets where they clicked "Skicka" in the time range.
    // Include both known agents (even if 0 tickets) and any other name
    // seen in the data, so we don't hide contributions.
    type AgentStats = { name: string; assigned: number; sent: number };
    const perUserMap = new Map<string, AgentStats>();
    for (const agent of AGENTS) {
      perUserMap.set(agent, { name: agent, assigned: 0, sent: 0 });
    }
    // sentBy is stored as session.user.name OR session.user.email, so
    // Malin sometimes gets logged as "Malin Sundberg" and sometimes as
    // "malin@doldadress.se". Resolve both forms back to the canonical
    // agent name when possible, otherwise the report shows her at 0.
    const resolveAgent = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      if (perUserMap.has(raw)) return raw;
      const lower = raw.toLowerCase();
      for (const agent of AGENTS) {
        if (agent.toLowerCase() === lower) return agent;
        const first = agent.split(' ')[0].toLowerCase();
        if (lower.includes(first)) return agent;
      }
      return raw;
    };
    for (const t of tickets) {
      if (t.assignedTo) {
        const name = resolveAgent(t.assignedTo) || t.assignedTo;
        const existing = perUserMap.get(name) || { name, assigned: 0, sent: 0 };
        existing.assigned += 1;
        perUserMap.set(name, existing);
      }
      if (t.sentBy) {
        const name = resolveAgent(t.sentBy) || t.sentBy;
        const existing = perUserMap.get(name) || { name, assigned: 0, sent: 0 };
        existing.sent += 1;
        perUserMap.set(name, existing);
      }
    }
    const perUserStats = Array.from(perUserMap.values())
      // Sort by sent desc, then assigned desc, known agents last as tiebreak
      .sort((a, b) => b.sent - a.sent || b.assigned - a.assigned || a.name.localeCompare(b.name));

    return NextResponse.json({
      totalTickets,
      ticketsByStatus,
      ticketsByPriority,
      avgResponseTime: Math.round(avgResponseTime * 10) / 10, // Round to 1 decimal
      resolvedToday,
      pendingTickets,
      recentActivity,
      perUserStats,
    });
  } catch (error) {
    console.error('Error fetching report data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch report data' },
      { status: 500 }
    );
  }
}
