import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { AGENTS } from '@/lib/constants';
import { requireApiAuth } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const searchParams = request.nextUrl.searchParams;
    const range = searchParams.get('range') || '30d';
    
    const tenant = await getTenant();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Calculate the date range. We align bucket boundaries to the ticket
    // filter so every ticket counted in totalTickets also maps to exactly
    // one bar in the activity chart — otherwise the totals and the chart
    // disagree and the chart looks broken.
    //
    // The "1d" range uses HOURLY buckets over the last 24 hours: a single
    // daily bar tells you nothing, and (worse) the old code anchored that
    // one bucket at midnight while fetching a rolling 24h window, so
    // tickets created the previous evening inflated totalTickets but never
    // showed up in the chart. All other ranges use one bucket per calendar
    // day anchored on midnight.
    const HOUR_MS = 60 * 60 * 1000;
    const DAY_MS = 24 * HOUR_MS;
    const now = new Date();
    const isHourly = range === '1d';
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Top of the current hour, used to align the 24 hourly buckets.
    const currentHourStart = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()
    );
    const daysAgo =
      range === '7d' ? 7 :
      range === '30d' ? 30 :
      range === '90d' ? 90 :
      30;
    const startDate = isHourly
      // 24 hourly buckets ending with the current (partial) hour.
      ? new Date(currentHourStart.getTime() - 23 * HOUR_MS)
      : new Date(todayStart.getTime() - (daysAgo - 1) * DAY_MS);

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

    // Resolved today. This is a "today" metric, independent of the selected
    // range — a ticket opened last week but closed this morning still counts.
    // We therefore query it directly rather than filtering the range-limited
    // `tickets` list (which previously undercounted on short ranges).
    const resolvedToday = await prisma.ticket.count({
      where: {
        tenantId: tenant.id,
        status: { in: ['sent', 'closed'] },
        updatedAt: { gte: todayStart },
      },
    });

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

    // Recent activity. Buckets are anchored to the same window as the ticket
    // filter so every ticket in totalTickets maps to exactly one bar. For the
    // "1d" range we emit 24 hourly buckets; otherwise one bucket per day.
    const countBetween = (from: Date, to: Date) =>
      tickets.filter((t) => {
        const c = new Date(t.createdAt);
        return c >= from && c < to;
      }).length;

    const recentActivity: Array<{ date: string; count: number }> = [];
    if (isHourly) {
      for (let i = 23; i >= 0; i--) {
        const hourStart = new Date(currentHourStart.getTime() - i * HOUR_MS);
        const hourEnd = new Date(hourStart.getTime() + HOUR_MS);
        recentActivity.push({
          // Full ISO timestamp so the client can render an hour label.
          date: hourStart.toISOString(),
          count: countBetween(hourStart, hourEnd),
        });
      }
    } else {
      for (let i = daysAgo - 1; i >= 0; i--) {
        const dayStart = new Date(todayStart.getTime() - i * DAY_MS);
        const dayEnd = new Date(dayStart.getTime() + DAY_MS);
        recentActivity.push({
          date: dayStart.toISOString().split('T')[0],
          count: countBetween(dayStart, dayEnd),
        });
      }
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
      // Tells the client how to label the activity bars ("14:00" vs "3 jun").
      activityInterval: isHourly ? 'hour' : 'day',
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
