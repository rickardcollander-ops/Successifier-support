// Shared, client-safe definitions for the configurable inbox tabs. No server
// imports here — both the tickets page and the Settings admin UI use this, and
// the API stores/returns the same shapes.

import { product } from '@/lib/products';
import { t } from '@/lib/i18n';
import {
  isVendorTicket,
  isBounceTicket,
  isUrgentPriority,
  BOUNCE_SENDER_PREFIXES,
  BOUNCE_SUBJECT_MARKERS,
} from '@/lib/ticket-filters';

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

// --- Built-in folder rules ----------------------------------------------
//
// SINGLE SOURCE OF TRUTH for what each built-in tab shows. The inbox
// (app/tickets/page.tsx) filters with `matches`; the Settings UI renders
// `describe()` read-only so admins can see the rules behind the existing
// folders. The descriptions are derived from the real predicates and the
// shared constants (vendor senders, bounce markers) rather than re-typed, so
// they can't drift from the actual filtering.

// Status folders: one ticket status each, minus the vendor/bounce folders
// which have their own tabs.
const STATUS_TAB_KEYS = ['new', 'in_progress', 'review', 'sent', 'closed'] as const;

// Friendly names for the underlying status values (mirrors the inbox labels).
const STATUS_LABEL: Record<(typeof STATUS_TAB_KEYS)[number], () => string> = {
  new: () => t('Nya'),
  in_progress: () => t('Öppna'),
  review: () => t('Granskning'),
  sent: () => t('Skickade'),
  closed: () => t('Stängda'),
};

export interface BuiltinTabRule {
  // Whether a ticket belongs in this built-in folder. Omitted for `archived`,
  // which is loaded from a separate query rather than filtered client-side.
  matches?: (ticket: MatchableTicket) => boolean;
  // Localized, human-readable summary of the rule, shown read-only in Settings.
  describe: () => string;
}

const vendorSendersText = () =>
  product.vendorFolder.senders.length
    ? product.vendorFolder.senders.join(', ')
    : product.vendorFolder.label;

export const BUILTIN_TAB_RULES: Record<BuiltinTabKey, BuiltinTabRule> = {
  urgent: {
    matches: (tk) =>
      isUrgentPriority(tk) &&
      !isVendorTicket(tk) &&
      !isBounceTicket(tk) &&
      tk.status !== 'duplicate' &&
      tk.status !== 'closed' &&
      tk.status !== 'sent',
    describe: () =>
      `${t('Prioritet')}: ${t('Akut')}/${t('Hög')} — ${t('endast öppna ärenden, exkl. leverantörs-, studs- och dublettmappen')}`,
  },
  new: statusRule('new'),
  in_progress: statusRule('in_progress'),
  review: statusRule('review'),
  sent: statusRule('sent'),
  closed: statusRule('closed'),
  all: {
    matches: (tk) => !isVendorTicket(tk) && tk.status !== 'duplicate' && !isBounceTicket(tk),
    describe: () => t('Alla ärenden utom leverantörs-, studs- och dublettmappen'),
  },
  billecta: {
    matches: (tk) => isVendorTicket(tk),
    describe: () => `${t('Avsändare (e-post)')}: ${vendorSendersText()}`,
  },
  bounce: {
    matches: (tk) => isBounceTicket(tk),
    describe: () =>
      `${t('Avsändare börjar med')} ${BOUNCE_SENDER_PREFIXES.join(', ')} ${t('eller ämnet innehåller')} ${BOUNCE_SUBJECT_MARKERS.join(', ')}`,
  },
  duplicate: {
    matches: (tk) => tk.status === 'duplicate',
    describe: () => `${t('Status')}: ${t('Dubletter')}`,
  },
  archived: {
    // No client-side predicate — archived tickets are fetched on demand.
    describe: () => t('Arkiverade ärenden (hämtas separat)'),
  },
};

function statusRule(status: (typeof STATUS_TAB_KEYS)[number]): BuiltinTabRule {
  return {
    matches: (tk) => tk.status === status && !isVendorTicket(tk) && !isBounceTicket(tk),
    describe: () =>
      `${t('Status')}: ${STATUS_LABEL[status]()} — ${t('exkl. leverantörs- och studsmappen')}`,
  };
}

/** Read-only rule summary for a built-in tab, or null if the key is unknown. */
export function builtinTabRuleText(key: string): string | null {
  const rule = (BUILTIN_TAB_RULES as Record<string, BuiltinTabRule>)[key];
  return rule ? rule.describe() : null;
}
