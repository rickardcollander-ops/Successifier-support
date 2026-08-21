import { describe, expect, it } from 'vitest';
import {
  generateWebhookSecret,
  verifyWebhookSignature,
  webhookSignature,
  webhookSignatureHeader,
} from '@/lib/webhooks/signature';
import {
  SUBSCRIBABLE_EVENT_TYPES,
  buildEnvelope,
  normalizeSubscription,
  subscribesTo,
  ticketEventData,
} from '@/lib/webhooks/events';
import { isPrivateAddress, resolvesToPublicHost, validateWebhookUrl } from '@/lib/webhooks/url';

const SECRET = 'whsec_test_secret';
const BODY = JSON.stringify({ id: 'evt_1', type: 'ticket.created', data: { id: 't1' } });

describe('webhook signatures', () => {
  it('verifies a delivery we just signed', () => {
    const t = Math.floor(Date.now() / 1000);
    const header = webhookSignatureHeader(BODY, SECRET, t);
    expect(verifyWebhookSignature(BODY, header, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const t = Math.floor(Date.now() / 1000);
    const header = webhookSignatureHeader(BODY, SECRET, t);
    const tampered = BODY.replace('t1', 't2');
    expect(verifyWebhookSignature(tampered, header, SECRET)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const t = Math.floor(Date.now() / 1000);
    const header = webhookSignatureHeader(BODY, SECRET, t);
    expect(verifyWebhookSignature(BODY, header, 'whsec_other')).toBe(false);
  });

  it('rejects a replay outside the tolerance window', () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    const header = webhookSignatureHeader(BODY, SECRET, old);
    // Same bytes, valid HMAC — only the age makes it invalid.
    expect(webhookSignature(BODY, SECRET, old)).toBe(header.split('v1=')[1]);
    expect(verifyWebhookSignature(BODY, header, SECRET)).toBe(false);
  });

  it('rejects a timestamp swapped after signing', () => {
    const t = Math.floor(Date.now() / 1000);
    const header = webhookSignatureHeader(BODY, SECRET, t);
    const forged = header.replace(`t=${t}`, `t=${t - 10}`);
    expect(verifyWebhookSignature(BODY, forged, SECRET)).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, 'garbage', SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, 't=abc,v1=def', SECRET)).toBe(false);
  });

  it('mints distinct, prefixed secrets', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
  });
});

describe('webhook subscriptions', () => {
  it('treats an empty selection as "every event"', () => {
    expect(subscribesTo([], 'ticket.created')).toBe(true);
    expect(subscribesTo(null, 'ticket.response_sent')).toBe(true);
  });

  it('filters to the selected events', () => {
    expect(subscribesTo(['ticket.created'], 'ticket.created')).toBe(true);
    expect(subscribesTo(['ticket.created'], 'ticket.updated')).toBe(false);
  });

  it('always delivers a ping, since it targets one endpoint on purpose', () => {
    expect(subscribesTo(['ticket.created'], 'ping')).toBe(true);
  });

  it('rejects unknown event names and de-duplicates valid ones', () => {
    expect(normalizeSubscription(['ticket.created', 'ticket.created'])).toEqual({
      ok: true,
      events: ['ticket.created'],
    });
    expect(normalizeSubscription(undefined)).toEqual({ ok: true, events: [] });
    const invalid = normalizeSubscription(['ticket.exploded']);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.invalid).toEqual(['ticket.exploded']);
  });

  it('does not offer `ping` as something to subscribe to', () => {
    expect(SUBSCRIBABLE_EVENT_TYPES).not.toContain('ping');
    expect(SUBSCRIBABLE_EVENT_TYPES).toContain('ticket.created');
  });
});

describe('webhook payloads', () => {
  const ticket = {
    id: 't1',
    tenantId: 'tenant1',
    customerEmail: 'customer@example.com',
    customerName: null,
    subject: 'Need help',
    status: 'new',
    priority: 'normal',
    originalMessage: 'Hello',
    aiResponse: null,
    aiConfidence: null,
    createdAt: new Date('2026-08-21T09:15:00.000Z'),
    updatedAt: new Date('2026-08-21T09:15:00.000Z'),
    // Third-party customer records and mail attachments — must not leak
    // to a webhook receiver that only asked for ticket events.
    contextData: { stripe: { customerId: 'cus_123' } },
  } as any;

  it('never puts contextData on the wire', () => {
    const data = ticketEventData(ticket);
    expect(data).not.toHaveProperty('contextData');
    expect(JSON.stringify(data)).not.toContain('cus_123');
  });

  it('serializes dates as ISO strings', () => {
    const data = ticketEventData(ticket);
    expect(data.createdAt).toBe('2026-08-21T09:15:00.000Z');
    expect(data.sentAt).toBeNull();
  });

  it('wraps data in a typed, identified envelope', () => {
    const envelope = buildEnvelope({
      id: 'evt_1',
      type: 'ticket.created',
      tenantId: 'tenant1',
      data: ticketEventData(ticket),
      createdAt: new Date('2026-08-21T09:15:01.000Z'),
    });
    expect(envelope).toMatchObject({
      id: 'evt_1',
      type: 'ticket.created',
      tenantId: 'tenant1',
      createdAt: '2026-08-21T09:15:01.000Z',
    });
    expect((envelope.data as any).id).toBe('t1');
  });
});

describe('webhook URL validation', () => {
  it('accepts a public https URL', () => {
    expect(validateWebhookUrl('https://example.com/hooks/support')).toEqual({
      ok: true,
      url: 'https://example.com/hooks/support',
    });
  });

  it('rejects plain http on a public host', () => {
    const result = validateWebhookUrl('http://example.com/hooks', { allowLocal: false });
    expect(result.ok).toBe(false);
  });

  it('blocks loopback, private ranges and cloud metadata (SSRF)', () => {
    for (const url of [
      'https://127.0.0.1/hooks',
      'https://localhost/hooks',
      'https://10.0.0.5/hooks',
      'https://192.168.1.10/hooks',
      'https://172.16.0.3/hooks',
      'https://169.254.169.254/latest/meta-data/',
      'https://vault.internal/hooks',
    ]) {
      expect(validateWebhookUrl(url, { allowLocal: false }).ok, url).toBe(false);
    }
  });

  it('allows loopback in development so integrators can test against a tunnel or local server', () => {
    expect(validateWebhookUrl('http://localhost:4000/hooks', { allowLocal: true }).ok).toBe(true);
  });

  it('rejects credentials embedded in the URL', () => {
    expect(validateWebhookUrl('https://user:pass@example.com/hooks').ok).toBe(false);
  });

  it('rejects junk', () => {
    expect(validateWebhookUrl('not a url').ok).toBe(false);
    expect(validateWebhookUrl('').ok).toBe(false);
    expect(validateWebhookUrl(null).ok).toBe(false);
  });
});

describe('webhook SSRF guards', () => {
  it('classifies resolved addresses, including IPv4-mapped IPv6', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:169.254.169.254',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }

    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1::']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses a public hostname that resolves into the private network', async () => {
    // The literal-host check passes — only resolution catches this, which is
    // why it runs before every delivery and not just at registration.
    expect(validateWebhookUrl('https://rebind.example.com/hooks', { allowLocal: false }).ok).toBe(true);
    expect(await resolvesToPublicHost('localhost', { allowLocal: false })).toBe(false);
  });

  it('fails closed on a name that does not resolve', async () => {
    expect(
      await resolvesToPublicHost('nonexistent.invalid', { allowLocal: false }),
    ).toBe(false);
  });
});
