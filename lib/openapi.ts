import { product } from '@/lib/products';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events';
import { SIGNATURE_HEADER, EVENT_HEADER, DELIVERY_HEADER } from '@/lib/webhooks/signature';

// Machine-readable description of the public API, so integrators can import
// it into Postman/Insomnia or generate a client instead of hand-writing one.
// Outbound events are described under OpenAPI 3.1's `webhooks` field, which
// is exactly what it exists for.
//
// Kept as a pure builder (no request, no database) so tests/openapi.test.ts
// can assert the spec stays in sync with the real event catalogue.

const TICKET_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    customerEmail: { type: 'string', format: 'email' },
    customerName: { type: ['string', 'null'] },
    subject: { type: 'string' },
    status: {
      type: 'string',
      enum: ['new', 'in_progress', 'waiting_ai', 'review', 'sent', 'closed', 'archived', 'duplicate'],
    },
    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
    category: { type: ['string', 'null'] },
    originalMessage: { type: 'string' },
    aiResponse: {
      type: ['string', 'null'],
      description: 'Null until the AI draft finishes — announced by the ticket.ai_response_generated webhook.',
    },
    aiConfidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    finalResponse: { type: ['string', 'null'] },
    assignedTo: { type: ['string', 'null'] },
    sentBy: { type: ['string', 'null'] },
    sentAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'customerEmail', 'subject', 'status', 'priority', 'createdAt', 'updatedAt'],
} as const;

const ERROR_SCHEMA = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
}

function webhookEvent(type: string, description: string) {
  return {
    post: {
      summary: type,
      description,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              allOf: [
                { $ref: '#/components/schemas/WebhookEnvelope' },
                { type: 'object', properties: { type: { const: type } } },
              ],
            },
          },
        },
      },
      parameters: [
        {
          name: SIGNATURE_HEADER,
          in: 'header',
          required: true,
          schema: { type: 'string' },
          description: 't=<unix seconds>,v1=<hex HMAC-SHA256 over "<t>.<raw body>">',
        },
        { name: EVENT_HEADER, in: 'header', required: true, schema: { type: 'string' } },
        { name: DELIVERY_HEADER, in: 'header', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '2xx': { description: 'Acknowledged. Anything else is retried (1s, 3s).' },
      },
    },
  };
}

/** Build the OpenAPI 3.1 document for the deployment reachable at `appDomain`. */
export function buildOpenApiSpec(appDomain: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: `${product.displayName} Support API`,
      version: '1.0.0',
      description:
        'Tickets, inbound intake and outbound webhooks. Authenticate with an API key created under Developer → API Keys.',
    },
    servers: [{ url: `${appDomain}/api` }],
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    paths: {
      '/tickets': {
        get: {
          summary: 'List tickets',
          description:
            'Open tickets by default. Pass `since` for a delta poll, or `status=archived` for the paged archive.',
          parameters: [
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string' },
              description: 'Pass `archived` to list archived tickets; otherwise archived tickets are excluded.',
            },
            {
              name: 'since',
              in: 'query',
              schema: { type: 'string', format: 'date-time' },
              description: 'ISO timestamp — return only tickets changed since then.',
            },
            {
              name: 'q',
              in: 'query',
              schema: { type: 'string' },
              description: 'Search the archive (only with status=archived).',
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', minimum: 0 },
              description: 'Archive paging, 200 per page (only with status=archived).',
            },
          ],
          responses: {
            '200': {
              description: 'Tickets, plus the id set of everything currently visible.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      tickets: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } },
                      ids: { type: 'array', items: { type: 'string' } },
                      total: { type: 'integer' },
                      delta: { type: 'boolean' },
                      serverTime: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
            '401': errorResponse('Invalid or missing API key'),
          },
        },
        post: {
          summary: 'Create a ticket',
          description:
            'Returns immediately with aiResponse: null; the AI draft is generated asynchronously.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    customerEmail: { type: 'string', format: 'email' },
                    customerName: { type: 'string' },
                    subject: { type: 'string' },
                    originalMessage: { type: 'string' },
                    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
                  },
                  required: ['customerEmail', 'subject', 'originalMessage'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'The created ticket',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Ticket' } } },
            },
            '400': errorResponse('Missing required fields'),
            '401': errorResponse('Invalid or missing API key'),
          },
        },
      },
      '/tickets/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          summary: 'Get a ticket',
          description: 'Includes contextData — the records gathered from your connected systems.',
          responses: {
            '200': {
              description: 'The ticket',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Ticket' } } },
            },
            '404': errorResponse('Ticket not found'),
          },
        },
        patch: {
          summary: 'Update a ticket',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
                    assignedTo: { type: 'string' },
                    customerEmail: { type: 'string', format: 'email' },
                    customerName: { type: 'string' },
                    subject: { type: 'string' },
                    aiResponse: { type: 'string' },
                    finalResponse: { type: 'string' },
                    originalMessage: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'The updated ticket',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Ticket' } } },
            },
            '404': errorResponse('Ticket not found'),
          },
        },
        delete: {
          summary: 'Delete a ticket',
          responses: {
            '200': {
              description: 'Deleted',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { success: { type: 'boolean' } } },
                },
              },
            },
            '404': errorResponse('Ticket not found'),
          },
        },
      },
      '/tickets/{id}/send': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        post: {
          summary: 'Send a reply to the customer',
          description: 'Emails the reply and moves the ticket to `sent`. Rate limited to 30/min per IP.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { response: { type: 'string' } },
                  required: ['response'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'The sent ticket',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Ticket' } } },
            },
            '429': errorResponse('Too many requests — see the Retry-After header'),
          },
        },
      },
      '/webhook/ticket': {
        post: {
          summary: 'Inbound intake (create or thread a ticket)',
          description:
            'Flatter body than POST /tickets, with threading: a Re:/Sv: subject reopens the matching ticket, and repeats within 10 minutes are merged. Rate limited to 30/min per IP.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string', format: 'email' },
                    name: { type: 'string' },
                    subject: { type: 'string' },
                    message: { type: 'string' },
                    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
                  },
                  required: ['email', 'subject', 'message'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Created or merged',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      ticketId: { type: 'string' },
                      merged: {
                        type: 'boolean',
                        description: 'True when the message joined an existing ticket.',
                      },
                    },
                  },
                },
              },
            },
            '400': errorResponse('Missing required fields'),
            '429': errorResponse('Too many requests'),
          },
        },
      },
    },
    webhooks: Object.fromEntries(
      WEBHOOK_EVENTS.map((event) => [event.type, webhookEvent(event.type, event.description)]),
    ),
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        BearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        Ticket: TICKET_SCHEMA,
        Error: ERROR_SCHEMA,
        WebhookEnvelope: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable across retries — use it for idempotency.' },
            type: { type: 'string', enum: WEBHOOK_EVENTS.map((e) => e.type) },
            createdAt: { type: 'string', format: 'date-time' },
            tenantId: { type: 'string' },
            data: {
              description: 'The ticket, minus contextData. `ping` carries a message instead.',
              $ref: '#/components/schemas/Ticket',
            },
          },
          required: ['id', 'type', 'createdAt', 'tenantId', 'data'],
        },
      },
    },
  };
}
