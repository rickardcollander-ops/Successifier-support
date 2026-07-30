import { product } from '@/lib/products';
import { t } from '@/lib/i18n';

// NOTE: everything in this module reads the ACTIVE tenant's config lazily
// (per request on the server, provider-installed on the client). Never
// capture product.* in a module-level constant — that would freeze one
// tenant's values into shared module state.

/**
 * List of agents who can be assigned tickets and whose stats are broken
 * out in the reports page, for the active tenant. Managed in the tenant's
 * settings (Tenant.settings.agents).
 *
 * When a user signs in with a name that matches one of these, their work
 * is tracked against that name. Assignments use the same list as the
 * source of truth.
 */
export function getAgents(): readonly string[] {
  return product.agents;
}

// Per-agent email sign-off. When an agent sends a reply we automatically
// swap the AI's generic support sign-off (e.g. "Doldadress Kundtjänst")
// for the agent's personal one so the customer sees who actually answered.
// The matching is loose (first name) so a Google account showing
// "Ida Test Rosell" or "ida@doldadress.se" still resolves to Ida's signature.
export function getAgentSignatures(): Record<string, string> {
  return product.agentSignatures;
}

function defaultSignature(): string {
  const greeting = product.language === 'en' ? 'Best regards,' : 'Vänliga hälsningar,';
  return `${greeting}\n${product.supportName}`;
}

export function signatureFor(nameOrEmail: string | null | undefined): string {
  const signatures = getAgentSignatures();
  if (!nameOrEmail) return defaultSignature();
  const direct = signatures[nameOrEmail];
  if (direct) return direct;
  const lower = nameOrEmail.toLowerCase();
  for (const [agent, sig] of Object.entries(signatures)) {
    const first = agent.split(' ')[0].toLowerCase();
    if (lower.includes(first)) return sig;
  }
  return defaultSignature();
}

// Match the generic AI sign-off so we can replace it. The AI is told to
// always end its replies with this exact sign-off (see ai-generator.ts).
// Built from the active tenant's support name so it tracks the brand.
function genericSignoffPattern(): RegExp {
  const supportNameRe = product.supportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:Vänliga hälsningar,\\s*\\n\\s*${supportNameRe}|Med vänlig hälsning,\\s*\\n\\s*${supportNameRe}|${supportNameRe})\\s*$`,
    'i',
  );
}

export function applyAgentSignature(body: string, nameOrEmail: string | null | undefined): string {
  if (!body) return body;
  const sig = signatureFor(nameOrEmail);
  const trimmed = body.replace(/\s+$/, '');
  // The AI no longer writes its own sign-off, so normally there is nothing
  // to replace. We still match the legacy generic sign-off (older drafts
  // may contain it) and swap it for the resolved signature.
  const pattern = genericSignoffPattern();
  if (pattern.test(trimmed)) {
    return trimmed.replace(pattern, sig);
  }
  // No sign-off in the body — append the signature so the customer
  // still sees who answered.
  return `${trimmed}\n\n${sig}`;
}

// Remove a trailing agent signature so the sent reply can be compared
// like-for-like with the AI draft. The draft is stored WITHOUT a sign-off,
// but send appends one (applyAgentSignature), so a verbatim send otherwise
// looks "edited" by exactly the signature's worth of words — which made the
// reports massively over-count manual intervention. Matches the known
// signature blocks exactly so it never strips a customer's own content.
export function stripAgentSignature(text: string | null | undefined): string {
  if (!text) return '';
  const trimmed = text.replace(/\s+$/, '');
  // Every signature applyAgentSignature can attach: the per-agent blocks
  // plus the generic default.
  const allSignatures = [...Object.values(getAgentSignatures()), defaultSignature()];
  for (const sig of allSignatures) {
    const sigTrimmed = sig.trim();
    if (sigTrimmed && trimmed.endsWith(sigTrimmed)) {
      return trimmed.slice(0, trimmed.length - sigTrimmed.length).replace(/\s+$/, '');
    }
  }
  return trimmed;
}

// Distinct "sharp" colors per agent so it's obvious at a glance who is
// looking at — or assigned to — a ticket when support is working in
// parallel. Tailwind hex values rather than classes to keep the color
// consistent across backgrounds, borders and avatar chips.
export interface AgentColor {
  bg: string;
  border: string;
  text: string;
}

const DEFAULT_AGENT_COLOR: AgentColor = {
  bg: '#7C5CFF',
  border: '#6B4FE0',
  text: '#FFFFFF',
};

export function agentColor(nameOrEmail: string | null | undefined): AgentColor {
  const colors: Record<string, AgentColor> = product.agentColors;
  if (!nameOrEmail) return DEFAULT_AGENT_COLOR;
  const direct = colors[nameOrEmail];
  if (direct) return direct;
  const lower = nameOrEmail.toLowerCase();
  for (const [agent, color] of Object.entries(colors)) {
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
      return t('Nytt');
    case 'in_progress':
      return t('Öppna');
    case 'waiting_ai':
      return t('Väntar på AI');
    case 'review':
      return t('Granskning');
    case 'sent':
      return t('Skickat');
    case 'closed':
      return t('Stängt');
    case 'archived':
      return t('Arkiverat');
    case 'duplicate':
      return t('Dubblett');
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
      return t('Akut');
    case 'high':
      return t('Hög');
    case 'normal':
      return t('Normal');
    case 'low':
      return t('Låg');
    default:
      return priority;
  }
}
