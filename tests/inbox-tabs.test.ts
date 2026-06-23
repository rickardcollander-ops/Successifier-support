import { describe, it, expect } from 'vitest';
import { BUILTIN_TAB_RULES, builtinTabRuleText, type MatchableTicket } from '@/lib/inbox-tabs';
import {
  isVendorTicket,
  isBounceTicket,
  isUrgentPriority,
  BOUNCE_SENDER_PREFIXES,
  BOUNCE_SUBJECT_MARKERS,
} from '@/lib/ticket-filters';
import { product } from '@/lib/products';

const ticket = (over: Partial<MatchableTicket> = {}): MatchableTicket => ({
  status: 'new',
  priority: 'normal',
  customerEmail: 'kund@example.com',
  subject: 'Fråga om fakturan',
  ...over,
});

describe('BUILTIN_TAB_RULES predicates', () => {
  it('status folders match their status, minus the vendor/bounce folders', () => {
    for (const status of ['new', 'in_progress', 'review', 'sent', 'closed'] as const) {
      const rule = BUILTIN_TAB_RULES[status];
      expect(rule.matches!(ticket({ status }))).toBe(true);
      expect(rule.matches!(ticket({ status: 'duplicate' }))).toBe(false);
      // A vendor/bounce ticket of that status belongs in its own folder.
      const vendor = product.vendorFolder.senders[0];
      if (vendor) expect(rule.matches!(ticket({ status, customerEmail: vendor }))).toBe(false);
      expect(rule.matches!(ticket({ status, customerEmail: 'mailer-daemon@x.com' }))).toBe(false);
    }
  });

  it('urgent matches red, open tickets only — not closed/sent/duplicate/vendor/bounce', () => {
    const m = BUILTIN_TAB_RULES.urgent.matches!;
    expect(m(ticket({ priority: 'urgent' }))).toBe(true);
    expect(m(ticket({ priority: 'high' }))).toBe(true);
    expect(m(ticket({ priority: 'normal' }))).toBe(false);
    expect(m(ticket({ priority: 'urgent', status: 'closed' }))).toBe(false);
    expect(m(ticket({ priority: 'urgent', status: 'sent' }))).toBe(false);
    expect(m(ticket({ priority: 'urgent', status: 'duplicate' }))).toBe(false);
    expect(m(ticket({ priority: 'urgent', customerEmail: 'postmaster@x.com' }))).toBe(false);
  });

  it('all excludes vendor, bounce and duplicates', () => {
    const m = BUILTIN_TAB_RULES.all.matches!;
    expect(m(ticket())).toBe(true);
    expect(m(ticket({ status: 'duplicate' }))).toBe(false);
    expect(m(ticket({ subject: 'Delivery Status Notification (Failure)' }))).toBe(false);
  });

  it('duplicate / billecta / bounce delegate to the shared predicates', () => {
    expect(BUILTIN_TAB_RULES.duplicate.matches!(ticket({ status: 'duplicate' }))).toBe(true);
    const vendor = product.vendorFolder.senders[0];
    if (vendor) {
      const t = ticket({ customerEmail: vendor });
      expect(BUILTIN_TAB_RULES.billecta.matches!(t)).toBe(isVendorTicket(t));
    }
    const bounced = ticket({ customerEmail: 'mailer-daemon@host.com' });
    expect(BUILTIN_TAB_RULES.bounce.matches!(bounced)).toBe(isBounceTicket(bounced));
  });

  it('urgent predicate stays aligned with isUrgentPriority', () => {
    const t = ticket({ priority: 'high' });
    expect(BUILTIN_TAB_RULES.urgent.matches!(t)).toBe(isUrgentPriority(t));
  });

  it('archived has no client-side predicate (fetched separately)', () => {
    expect(BUILTIN_TAB_RULES.archived.matches).toBeUndefined();
  });
});

describe('builtinTabRuleText (Settings rule descriptions)', () => {
  it('returns a description for every built-in tab and null for unknown keys', () => {
    for (const key of Object.keys(BUILTIN_TAB_RULES)) {
      expect(builtinTabRuleText(key)).toBeTruthy();
    }
    expect(builtinTabRuleText('does-not-exist')).toBeNull();
  });

  it('derives the bounce description from the real matcher constants', () => {
    const text = builtinTabRuleText('bounce')!;
    for (const p of BOUNCE_SENDER_PREFIXES) expect(text).toContain(p);
    for (const m of BOUNCE_SUBJECT_MARKERS) expect(text).toContain(m);
  });

  it('derives the vendor description from the product vendor senders', () => {
    const text = builtinTabRuleText('billecta')!;
    if (product.vendorFolder.senders.length) {
      expect(text).toContain(product.vendorFolder.senders[0]);
    }
  });
});
