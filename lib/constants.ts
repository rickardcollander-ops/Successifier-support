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

// Distinct "sharp" colors per agent so it's obvious at a glance who is
// looking at — or assigned to — a ticket when support is working in
// parallel. Tailwind hex values rather than classes to keep the color
// consistent across backgrounds, borders and avatar chips.
export interface AgentColor {
  bg: string;
  border: string;
  text: string;
}

const AGENT_COLORS: Record<string, AgentColor> = {
  'Ida Rosell': { bg: '#DC2626', border: '#B91C1C', text: '#FFFFFF' },
  'Malin Sundberg': { bg: '#16A34A', border: '#15803D', text: '#FFFFFF' },
};

const DEFAULT_AGENT_COLOR: AgentColor = {
  bg: '#7C5CFF',
  border: '#6B4FE0',
  text: '#FFFFFF',
};

export function agentColor(nameOrEmail: string | null | undefined): AgentColor {
  if (!nameOrEmail) return DEFAULT_AGENT_COLOR;
  const direct = AGENT_COLORS[nameOrEmail];
  if (direct) return direct;
  const lower = nameOrEmail.toLowerCase();
  for (const [agent, color] of Object.entries(AGENT_COLORS)) {
    const first = agent.split(' ')[0].toLowerCase();
    if (lower.includes(first)) return color;
  }
  return DEFAULT_AGENT_COLOR;
}

/**
 * Map a raw ticket status to a Swedish display label. Unknown values are
 * returned as-is so we don't hide data.
 */
export function statusLabelSv(status: string): string {
  switch (status) {
    case 'new':
      return 'Nytt';
    case 'in_progress':
      return 'Öppna';
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
