// Shared, client-safe definitions for the configurable inbox tabs. No server
// imports here — both the tickets page and the Settings admin UI use this, and
// the API stores/returns the same shapes.

export type TabRuleField = 'status' | 'priority' | 'sender' | 'subject';
export type TabRuleOp = 'in' | 'not_in' | 'contains' | 'not_contains';

export interface TabCondition {
  field: TabRuleField;
  op: TabRuleOp;
  // For status/priority a list of allowed values; for sender/subject a
  // substring (string) or list of substrings (any-of).
  value: string | string[];
}

export interface TabRules {
  match: 'all' | 'any';
  conditions: TabCondition[];
}

// One tab as stored in the DB / returned by the API.
export interface StoredTab {
  key: string;
  label: string;
  order: number;
  visible: boolean;
  isCustom: boolean;
  rules?: TabRules | null;
}

// One tab as the UI consumes it (defaults already merged in).
export interface InboxTabConfig {
  key: string;
  label: string;
  order: number;
  visible: boolean;
  isCustom: boolean;
  rules?: TabRules | null;
}

// Stable ids of the built-in folders, in their default display order. The
// inbox knows how to filter each of these; custom tabs use `rules` instead.
export const BUILTIN_TAB_KEYS = [
  'urgent',
  'new',
  'in_progress',
  'review',
  'sent',
  'closed',
  'all',
  'billecta',
  'bounce',
  'duplicate',
  'archived',
] as const;

export type BuiltinTabKey = (typeof BUILTIN_TAB_KEYS)[number];

// Minimal ticket shape the rule evaluator needs.
export interface MatchableTicket {
  status: string;
  priority: string;
  customerEmail: string;
  subject: string;
}

function toLowerList(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value])
    .map((v) => String(v).toLowerCase().trim())
    .filter(Boolean);
}

function conditionMatches(ticket: MatchableTicket, c: TabCondition): boolean {
  const values = toLowerList(c.value);
  if (values.length === 0) return false;

  if (c.field === 'status' || c.field === 'priority') {
    const v = (c.field === 'status' ? ticket.status : ticket.priority).toLowerCase();
    if (c.op === 'in') return values.includes(v);
    if (c.op === 'not_in') return !values.includes(v);
    return false;
  }

  // sender / subject — substring matching
  const haystack = (c.field === 'sender' ? ticket.customerEmail : ticket.subject).toLowerCase();
  if (c.op === 'contains') return values.some((v) => haystack.includes(v));
  if (c.op === 'not_contains') return !values.some((v) => haystack.includes(v));
  return false;
}

/** Whether a ticket belongs in a custom tab defined by the given rules. */
export function ticketMatchesRules(ticket: MatchableTicket, rules?: TabRules | null): boolean {
  if (!rules || !Array.isArray(rules.conditions) || rules.conditions.length === 0) {
    return false;
  }
  return rules.match === 'any'
    ? rules.conditions.some((c) => conditionMatches(ticket, c))
    : rules.conditions.every((c) => conditionMatches(ticket, c));
}

/**
 * Merge the built-in defaults with whatever the tenant has stored. Built-ins
 * always appear (so a folder added in code later still shows up even on a
 * tenant that saved an older config); stored rows override label/visible/order;
 * custom tabs are appended. Result is sorted by `order`.
 */
export function buildTabList(
  defaults: Array<{ key: string; label: string }>,
  stored: StoredTab[],
): InboxTabConfig[] {
  const byKey = new Map(stored.map((r) => [r.key, r]));
  const out: InboxTabConfig[] = [];

  defaults.forEach((d, i) => {
    const r = byKey.get(d.key);
    out.push({
      key: d.key,
      label: (r?.label && r.label.trim()) || d.label,
      order: r?.order ?? i,
      visible: r?.visible ?? true,
      isCustom: false,
      rules: null,
    });
  });

  stored
    .filter((r) => r.isCustom)
    .forEach((r, i) => {
      out.push({
        key: r.key,
        label: r.label,
        order: r.order ?? defaults.length + i,
        visible: r.visible ?? true,
        isCustom: true,
        rules: r.rules ?? null,
      });
    });

  return out.sort((a, b) => a.order - b.order);
}

/** Generate a stable-ish slug for a new custom tab from its label. */
export function customTabSlug(label: string): string {
  const base = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `custom-${base || 'tab'}-${Math.random().toString(36).slice(2, 7)}`;
}
