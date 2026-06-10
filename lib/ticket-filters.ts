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

// Bounces (mailer-daemon, postmaster, delivery-status-notification…) get
// their own folder so they don't clutter the inbox. Match on sender prefix
// AND on the standard subject lines that bounce notifications use, since some
// bounces come from neutrally-named addresses but always have a recognizable
// subject.
export const isBounceTicket = (t: TicketLike) => {
  const email = t.customerEmail.toLowerCase();
  if (
    email.startsWith('mailer-daemon@') ||
    email.startsWith('postmaster@') ||
    email.startsWith('mailer-noreply@') ||
    email.includes('mail-daemon@')
  ) return true;
  const subj = t.subject.toLowerCase();
  return (
    subj.includes('delivery status notification') ||
    subj.includes('undeliverable') ||
    subj.includes('mail delivery failed') ||
    subj.includes('returned mail') ||
    subj.startsWith('failure notice')
  );
};
