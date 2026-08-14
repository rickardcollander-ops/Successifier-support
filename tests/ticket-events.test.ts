import { describe, expect, it } from 'vitest';
import { eventsFromTicketPatch, eventActor, TICKET_EVENT } from '@/lib/services/ticket-events';

const existing = {
  id: 't1',
  tenantId: 'tenant1',
  status: 'new',
  assignedTo: null as string | null,
};

describe('eventsFromTicketPatch', () => {
  it('emits status_changed with from/to on a real status change', () => {
    const events = eventsFromTicketPatch(existing, { status: 'in_progress' }, 'Ida Rosell');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: TICKET_EVENT.statusChanged,
      ticketId: 't1',
      tenantId: 'tenant1',
      actor: 'Ida Rosell',
      fromValue: 'new',
      toValue: 'in_progress',
    });
  });

  it('is a no-op when the PATCH re-sends the current values', () => {
    expect(eventsFromTicketPatch(existing, { status: 'new' }, 'api')).toHaveLength(0);
    expect(eventsFromTicketPatch(existing, { assignedTo: '' }, 'api')).toHaveLength(0);
    expect(eventsFromTicketPatch(existing, { subject: 'nytt ämne' }, 'api')).toHaveLength(0);
  });

  it('emits assigned with the previous assignee', () => {
    const events = eventsFromTicketPatch(
      { ...existing, assignedTo: 'Ida Rosell' },
      { assignedTo: 'Malin Sundberg' },
      'Malin Sundberg'
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: TICKET_EVENT.assigned,
      fromValue: 'Ida Rosell',
      toValue: 'Malin Sundberg',
    });
  });

  it('covers archiving from the inbox (status → archived)', () => {
    const events = eventsFromTicketPatch(
      { ...existing, status: 'sent' },
      { status: 'archived' },
      'api'
    );
    expect(events[0]).toMatchObject({
      type: TICKET_EVENT.statusChanged,
      fromValue: 'sent',
      toValue: 'archived',
    });
  });

  it('emits several events for a combined patch, including work_started', () => {
    const events = eventsFromTicketPatch(
      existing,
      { status: 'in_progress', assignedTo: 'Ida Rosell', workStartedAt: new Date() },
      'Ida Rosell'
    );
    expect(events.map((e) => e.type).sort()).toEqual(
      [TICKET_EVENT.assigned, TICKET_EVENT.statusChanged, TICKET_EVENT.workStarted].sort()
    );
  });
});

describe('eventActor', () => {
  it('canonicalises known agents and keeps unknown raw values', () => {
    expect(eventActor('malin@doldadress.se')).toBe('Malin Sundberg');
    expect(eventActor('cron-job')).toBe('cron-job');
    expect(eventActor(null)).toBeNull();
  });
});
