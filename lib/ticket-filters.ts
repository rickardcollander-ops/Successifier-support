import { product } from '@/lib/products';

// Shared folder predicates used by BOTH the inbox (app/tickets/page.tsx)
// and the reports API. They must stay identical — if the inbox hides a
// ticket from the normal tabs but the reports still count it, the numbers
// on the reports page stop matching what support sees and look "wrong".
//
// Minimal structural type so the helpers work on full client-side Tickets
// as well as raw Prisma rows on the server.
export interface TicketLike {
  customerEmail: string;
  subject: string;
}

// Senders routed into the product's vendor folder (Billecta for Doldadress,
// Stripe for Serus). Matched case-insensitively.
export const isVendorTicket = (t: TicketLike) =>
  product.vendorFolder.senders.includes(t.customerEmail.toLowerCase());

// The population the reports and staffing calculations count: the same
// tickets the inbox shows in its normal tabs. Vendor mail (Billecta/Stripe),
// bounces, dubletter and archived tickets live in separate folders and are
// excluded from the counters there — if the reports counted them the numbers
// would stop matching what support sees.
export interface ReportableLike extends TicketLike {
  status: string;
}
export const isReportable = (t: ReportableLike) =>
  t.status !== 'archived' &&
  t.status !== 'duplicate' &&
  !isVendorTicket(t) &&
  !isBounceTicket(t);

// "Red traffic-light" tickets (urgent/high) drive the "Akut ärende" folder so
// support finds the cases needing attention first.
export interface PriorityLike {
  priority: string;
}
export const isUrgentPriority = (t: PriorityLike) =>
  t.priority === 'urgent' || t.priority === 'high';

// Bounce detection sources — exported so the inbox-tab rule descriptions can
// reference the exact same lists they're matched against (no hand-written
// duplicate text that can drift from the predicate).
export const BOUNCE_SENDER_PREFIXES = [
  'mailer-daemon@',
  'postmaster@',
  'mailer-noreply@',
  'mail-daemon@',
] as const;

export const BOUNCE_SUBJECT_MARKERS = [
  'delivery status notification',
  'undeliverable',
  'mail delivery failed',
  'returned mail',
  'failure notice',
] as const;

// Bounces (mailer-daemon, postmaster, delivery-status-notification…) get
// their own folder so they don't clutter the inbox. Match on sender prefix
// AND on the standard subject lines that bounce notifications use, since some
// bounces come from neutrally-named addresses but always have a recognizable
// subject.
export const isBounceTicket = (t: TicketLike) => {
  const email = t.customerEmail.toLowerCase();
  // 'mail-daemon@' historically appeared mid-address, so it stays a substring
  // match; the rest are sender prefixes.
  if (
    BOUNCE_SENDER_PREFIXES.some((p) =>
      p === 'mail-daemon@' ? email.includes(p) : email.startsWith(p),
    )
  ) return true;
  const subj = t.subject.toLowerCase();
  // 'failure notice' is historically a subject prefix; the rest can appear
  // anywhere in the subject.
  return BOUNCE_SUBJECT_MARKERS.some((m) =>
    m === 'failure notice' ? subj.startsWith(m) : subj.includes(m),
  );
};
