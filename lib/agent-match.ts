import { getAgents } from '@/lib/constants';

// Resolve a free-text agent value back to the canonical agent name from the
// product's agent list. sentBy/assignedTo are stored as session.user.name OR
// session.user.email, so Malin sometimes gets logged as "Malin Sundberg" and
// sometimes as "malin@doldadress.se". Matching is on whole name/email tokens —
// a plain substring test wrongly credited e.g. "frida@…" to Ida.
//
// Shared by the reports API (per-agent stats and the agent filter), the
// ticket event log (events store the canonical name at write time) and the
// staffing calculations, so all three agree on who "Malin" is.
export function resolveAgentName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if ((getAgents() as readonly string[]).includes(raw)) return raw;
  const lower = raw.toLowerCase();
  const tokens = lower.split(/[^a-zåäöé]+/).filter(Boolean);
  for (const agent of getAgents()) {
    if (agent.toLowerCase() === lower) return agent;
    const first = agent.split(' ')[0].toLowerCase();
    if (tokens.includes(first)) return agent;
  }
  return null;
}
