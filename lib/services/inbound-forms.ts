// Parsing of contact-form notification emails.
//
// Some products receive support requests through a website contact form
// (e.g. Serus uses a Framer form on serus.ai). Those arrive as a
// notification email FROM a no-reply address (noreply@framer.com) where the
// real customer's name, email and message live in the BODY:
//
//   You've just received a new support ticket from the contact page ...
//   Name: Lorenzo Zamorano
//   Email: lorenzozamorano87@gmail.com
//   Message: Hi, I just want to see what data is exposed ...
//   Terms and conditions: on
//   This email is a submission of a Framer form. ...
//
// Two problems if we ingest these as-is:
//   1. The ticket's customer becomes noreply@framer.com, so "reply" goes to
//      Framer instead of the customer.
//   2. Every submission shares one Gmail thread, so unrelated customers get
//      merged into a single ticket.
//
// This module detects such emails and extracts the real customer so the
// sync can create one ticket per customer and reply to them directly.

export interface ParsedFormSubmission {
  customerEmail: string;
  customerName: string | null;
  message: string;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const FIELD_LABELS = String.raw`Name|Email|Message|Terms\s*(?:and|&)\s*conditions`;

function isFramerSubmission(from: string, body: string): boolean {
  if (/noreply@framer\.com/i.test(from)) return true;
  if (/submission of a Framer form/i.test(body)) return true;
  return false;
}

// Value of a single-line label like "Name:" / "Email:". Stops at the end of
// the line, or at the next known label if the converter put them inline.
function singleLineField(body: string, label: string): string | null {
  const m = body.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`, 'i'));
  if (!m) return null;
  const value = m[1].split(new RegExp(`\\s*(?:${FIELD_LABELS})\\s*[:：]`, 'i'))[0].trim();
  return value || null;
}

// The free-text message. Spans multiple lines, so it stops only at the next
// label, the Framer footer, or end of body.
function messageField(body: string): string | null {
  const m = body.match(
    new RegExp(
      `Message\\s*[:：]\\s*([\\s\\S]*?)\\s*(?=(?:Terms\\s*(?:and|&)\\s*conditions)\\s*[:：]|This email is a submission of a Framer form|$)`,
      'i',
    ),
  );
  return m ? m[1].trim() : null;
}

function extractCustomerEmail(body: string): string | null {
  // Prefer the address on the "Email:" line; fall back to the first
  // non-Framer address anywhere in the body.
  const emailLine = singleLineField(body, 'Email');
  const labelled = emailLine?.match(EMAIL_RE)?.[0];
  if (labelled && !/@framer\.com$/i.test(labelled)) return labelled;

  const all = body.match(new RegExp(EMAIL_RE.source, 'gi')) || [];
  return all.find((e) => !/@framer\.com$/i.test(e)) ?? null;
}

/**
 * Detect and parse a website contact-form notification email. Returns the
 * real customer when the email is a recognised form submission, otherwise
 * null (the caller then treats it as a normal email). Returns null if no
 * usable customer email can be extracted — without one we can't route a
 * reply, so it's safer to keep the original sender.
 */
export function parseFramerForm(opts: { from: string; subject: string; body: string }): ParsedFormSubmission | null {
  if (!isFramerSubmission(opts.from, opts.body)) return null;

  const customerEmail = extractCustomerEmail(opts.body);
  if (!customerEmail) return null;

  return {
    customerEmail,
    customerName: singleLineField(opts.body, 'Name'),
    message: messageField(opts.body) || opts.body,
  };
}
