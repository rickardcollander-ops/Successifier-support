/**
 * Hardcoded list of agents who can be assigned tickets and whose stats
 * are broken out in the reports page. Add new agents here.
 *
 * When a user signs in with a name that matches one of these, their work
 * is tracked against that name. Assignments use the same list as the
 * source of truth.
 */
export const AGENTS: readonly string[] = [
  'Ida Rosell',
  'Malin Sundberg',
] as const;

/**
 * Map a raw ticket status to a Swedish display label. Unknown values are
 * returned as-is so we don't hide data.
 */
export function statusLabelSv(status: string): string {
  switch (status) {
    case 'new':
      return 'Nytt';
    case 'in_progress':
      return 'Pågående';
    case 'waiting_ai':
      return 'Väntar på AI';
    case 'review':
      return 'Granskning';
    case 'sent':
      return 'Skickat';
    case 'closed':
      return 'Stängt';
    case 'archived':
      return 'Arkiverat';
    case 'duplicate':
      return 'Dubblett';
    default:
      return status;
  }
}

/**
 * Map a ticket priority to a Swedish display label.
 */
export function priorityLabelSv(priority: string): string {
  switch (priority) {
    case 'urgent':
      return 'Akut';
    case 'high':
      return 'Hög';
    case 'normal':
      return 'Normal';
    case 'low':
      return 'Låg';
    default:
      return priority;
  }
}
