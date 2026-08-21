import { lookup } from 'dns/promises';

// Validation for customer-supplied webhook URLs.
//
// Beyond "is this a URL", this is an SSRF guard: we make an outbound POST to
// whatever is registered here, from inside our own network, and the delivery
// log shows the receiver's status code and the first bytes of its response.
// A URL pointing at loopback, a private range or the cloud metadata service
// would therefore turn the webhook feature into a request proxy with a
// readback channel — for a tenant admin, who is a customer, not an operator.
//
// Two layers, because a literal-hostname check alone is trivially bypassed by
// pointing a public DNS name at 169.254.169.254:
//   1. validateWebhookUrl  — shape, scheme, literal host (sync, at the edge)
//   2. resolvesToPublicHost — what the name actually resolves to (before every
//      delivery, not just at registration, since DNS can change afterwards)
// Redirect following is disabled at the fetch call for the same reason.

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./, // link-local, incl. 169.254.169.254 cloud metadata
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
  /^0\./,
];

/** Is this resolved IP address one we must never send a delivery to? */
export function isPrivateAddress(address: string): boolean {
  let ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  // Unwrap IPv4-mapped IPv6 (::ffff:127.0.0.1) before the IPv4 checks.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) ip = mapped[1];

  if (ip === '::' || ip === '::1') return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip)) return true;

  return PRIVATE_IPV4.some((pattern) => pattern.test(ip));
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  return isPrivateAddress(host);
}

export function validateWebhookUrl(
  raw: unknown,
  { allowLocal = process.env.NODE_ENV !== 'production' }: { allowLocal?: boolean } = {},
): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'url is required' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'url must be an absolute URL, e.g. https://example.com/hooks/support' };
  }

  const local = isPrivateHostname(parsed.hostname);

  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local && allowLocal)) {
    return { ok: false, error: 'url must use https' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'url must not contain credentials — use the signature to authenticate deliveries' };
  }

  if (local && !allowLocal) {
    return { ok: false, error: 'url must be publicly reachable — private and loopback addresses are not allowed' };
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * Does this hostname actually resolve to public addresses only? Checked
 * before every delivery, not just at registration: the name is the
 * customer's to repoint, and a rebind after approval would otherwise reach
 * straight into our network.
 *
 * Fails closed — an unresolvable name is not delivered to.
 */
export async function resolvesToPublicHost(
  hostname: string,
  { allowLocal = process.env.NODE_ENV !== 'production' }: { allowLocal?: boolean } = {},
): Promise<boolean> {
  if (allowLocal) return true;
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    if (!records.length) return false;
    return records.every((record) => !isPrivateAddress(record.address));
  } catch {
    return false;
  }
}

/** Convenience wrapper: validate the shape, then what it resolves to. */
export async function validateWebhookUrlResolved(
  raw: unknown,
  options: { allowLocal?: boolean } = {},
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const validated = validateWebhookUrl(raw, options);
  if (!validated.ok) return validated;

  const hostname = new URL(validated.url).hostname;
  if (!(await resolvesToPublicHost(hostname, options))) {
    return {
      ok: false,
      error: `url must resolve to a public address — ${hostname} does not`,
    };
  }
  return validated;
}
