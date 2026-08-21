// Validation for customer-supplied webhook URLs.
//
// Beyond "is this a URL", this is an SSRF guard: we make an outbound POST to
// whatever is registered here, from inside our own network, so a URL pointing
// at loopback, a private range or the cloud metadata service would turn the
// webhook feature into a request proxy. Registration is admin-only, but the
// blast radius of a mistake is large enough to be worth blocking outright.

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./, // link-local, incl. 169.254.169.254 cloud metadata
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  return PRIVATE_IPV4.some((pattern) => pattern.test(host));
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
