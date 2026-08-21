import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '@/lib/openapi';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events';

const spec = buildOpenApiSpec('https://acme.example.com') as any;

// Collect every "$ref" in the document so we can prove each one resolves —
// a dangling ref makes the spec unusable in Postman and every generator.
function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectRefs(child, out));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') out.push(value);
      else collectRefs(value, out);
    }
  }
  return out;
}

function resolve(ref: string): unknown {
  return ref
    .replace(/^#\//, '')
    .split('/')
    .reduce<any>((node, segment) => (node ? node[segment] : undefined), spec);
}

describe('OpenAPI spec', () => {
  it('is a 3.1 document served from the request origin', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.servers).toEqual([{ url: 'https://acme.example.com/api' }]);
  });

  it('serializes to JSON (no functions, cycles or undefined values)', () => {
    const json = JSON.parse(JSON.stringify(spec));
    expect(json.paths['/tickets'].post.summary).toBe('Create a ticket');
  });

  it('documents every endpoint an integrator needs', () => {
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/tickets',
      '/tickets/{id}',
      '/tickets/{id}/send',
      '/webhook/ticket',
    ]);
    expect(Object.keys(spec.paths['/tickets/{id}'])).toEqual(
      expect.arrayContaining(['get', 'patch', 'delete']),
    );
  });

  it('declares both accepted credential forms', () => {
    expect(spec.components.securitySchemes.ApiKeyAuth).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    });
    expect(spec.components.securitySchemes.BearerAuth.scheme).toBe('bearer');
  });

  it('describes exactly the events we actually send', () => {
    expect(Object.keys(spec.webhooks).sort()).toEqual(WEBHOOK_EVENTS.map((e) => e.type).sort());
    expect(spec.components.schemas.WebhookEnvelope.properties.type.enum).toEqual(
      WEBHOOK_EVENTS.map((e) => e.type),
    );
  });

  it('requires the signature header on every webhook delivery', () => {
    for (const [type, path] of Object.entries<any>(spec.webhooks)) {
      const signature = path.post.parameters.find((p: any) => p.name === 'X-Successifier-Signature');
      expect(signature?.required, type).toBe(true);
    }
  });

  it('has no dangling $refs', () => {
    const refs = collectRefs(spec);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(resolve(ref), ref).toBeDefined();
    }
  });

  it('marks the required fields of a created ticket', () => {
    const schema = spec.paths['/tickets'].post.requestBody.content['application/json'].schema;
    expect(schema.required).toEqual(['customerEmail', 'subject', 'originalMessage']);
  });
});
