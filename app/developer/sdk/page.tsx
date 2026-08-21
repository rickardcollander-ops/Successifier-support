import { headers } from 'next/headers';
import { product } from '@/lib/products';
import { resolveTenantFromHeaders } from '@/lib/products/tenant';
import { SIGNATURE_HEADER } from '@/lib/webhooks/signature';

export default async function SdkPage() {
  await resolveTenantFromHeaders();
  // Same origin derivation as the docs page: every snippet should be
  // pasteable as-is on the domain the admin is actually looking at.
  const h = await headers();
  const host = h.get('host') ?? `your-subdomain.${product.apiBaseDomain}`;
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const appDomain = `${proto}://${host}`;
  const keyExample = `${product.apiKeyPrefix}_your_api_key_here`;
  const envVar = `${product.key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">Client &amp; examples</h1>
        <p className="text-slate-600 dark:text-slate-400">
          A complete, dependency-free TypeScript client for the {product.displayName} Support API —
          copy it into your codebase and you are done. There is nothing to install: the API is
          plain HTTPS + JSON, and a package would only be one more thing to keep in version sync.
        </p>
      </div>

      {/* The client */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">support-client.ts</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          Node 18+ (or any runtime with global <span className="font-mono">fetch</span>). Save it as{' '}
          <span className="font-mono">support-client.ts</span>; the JavaScript version is the same
          file with the types removed.
        </p>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
          <code>{`export type TicketStatus =
  | 'new' | 'in_progress' | 'sent' | 'closed' | 'archived' | 'duplicate';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Ticket {
  id: string;
  tenantId: string;
  customerEmail: string;
  customerName: string | null;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  originalMessage: string;
  /** null until the AI draft finishes — see the ticket.ai_response_generated webhook. */
  aiResponse: string | null;
  aiConfidence: number | null;
  finalResponse?: string | null;
  assignedTo?: string | null;
  sentBy?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTicketInput {
  customerEmail: string;
  subject: string;
  originalMessage: string;
  customerName?: string;
  priority?: TicketPriority;
}

export class SupportError extends Error {
  constructor(message: string, readonly statusCode: number, readonly body: unknown) {
    super(message);
    this.name = 'SupportError';
  }
}

export class SupportClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: { apiKey: string; baseUrl: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\\/+$/, '');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(\`\${this.baseUrl}/api\${path}\`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    const body = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message = (body && (body.error as string)) || response.statusText;
      throw new SupportError(message, response.status, body);
    }
    return body as T;
  }

  tickets = {
    create: (input: CreateTicketInput): Promise<Ticket> =>
      this.request<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(input) }),

    /** Pass { since } for a delta poll, or { status: 'archived' } for the archive. */
    list: (params: { status?: string; since?: string } = {}): Promise<{ tickets: Ticket[] }> => {
      const query = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v != null) as [string, string][],
      ).toString();
      return this.request<{ tickets: Ticket[] }>(\`/tickets\${query ? \`?\${query}\` : ''}\`);
    },

    get: (id: string): Promise<Ticket> => this.request<Ticket>(\`/tickets/\${id}\`),

    update: (
      id: string,
      patch: Partial<Pick<Ticket, 'status' | 'priority' | 'assignedTo' | 'finalResponse' | 'subject'>>,
    ): Promise<Ticket> =>
      this.request<Ticket>(\`/tickets/\${id}\`, { method: 'PATCH', body: JSON.stringify(patch) }),

    /** Sends the reply to the customer by email and marks the ticket sent. */
    send: (id: string, response: string): Promise<Ticket> =>
      this.request<Ticket>(\`/tickets/\${id}/send\`, {
        method: 'POST',
        body: JSON.stringify({ response }),
      }),
  };
}`}</code>
        </pre>
      </section>

      {/* Quick Start */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Quick start</h2>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
          <code>{`import { SupportClient } from './support-client';

const client = new SupportClient({
  apiKey: process.env.${envVar}!,   // '${keyExample}'
  baseUrl: '${appDomain}',
});

const ticket = await client.tickets.create({
  customerEmail: 'customer@example.com',
  customerName: 'John Doe',
  subject: 'Need help with billing',
  originalMessage: 'I have a question about my invoice...',
  priority: 'normal',
});

console.log('Ticket created:', ticket.id);
// ticket.aiResponse is null here — the draft is generated asynchronously.`}</code>
        </pre>
      </section>

      {/* Examples */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Examples</h2>

        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Read tickets</h3>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`// Everything currently open (archived tickets are excluded)
const { tickets } = await client.tickets.list();

// Delta poll: only what changed since your last sync
const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const { tickets: changed } = await client.tickets.list({ since });

// The archive
const { tickets: archived } = await client.tickets.list({ status: 'archived' });

// One ticket, with the AI draft and gathered context
const ticket = await client.tickets.get(tickets[0].id);
console.log(ticket.aiResponse, ticket.aiConfidence);`}</code>
          </pre>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-3">
            Filtering by status or priority beyond this is done on your side — the list endpoint
            returns the full open set so a delta poll stays a single request.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Update and reply</h3>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`await client.tickets.update(ticket.id, {
  status: 'in_progress',
  priority: 'high',
});

// Send the AI draft as-is…
await client.tickets.send(ticket.id, ticket.aiResponse!);

// …or your own text. Either way the customer gets the email and the
// ticket moves to 'sent'.
await client.tickets.send(ticket.id, 'Thank you for contacting us...');`}</code>
          </pre>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Error handling</h3>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`import { SupportError } from './support-client';

try {
  await client.tickets.create({
    customerEmail: 'customer@example.com',
    subject: 'Test',
    originalMessage: 'Test message',
  });
} catch (error) {
  if (error instanceof SupportError) {
    console.error(error.statusCode, error.message);
    if (error.statusCode === 429) {
      // Retry-After (seconds) is on the response headers.
    }
  }
}`}</code>
          </pre>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Receiving webhooks</h3>
          <p className="text-slate-600 dark:text-slate-400 mb-3">
            Register the endpoint under{' '}
            <a href="/developer/webhooks" className="text-[#7C5CFF] hover:underline">
              Developer → Webhooks
            </a>
            , then verify every delivery against the raw body. Full contract in{' '}
            <a href="/developer/docs#webhooks" className="text-[#7C5CFF] hover:underline">
              the webhook guide
            </a>
            .
          </p>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`import crypto from 'crypto';

export function verifyWebhook(rawBody: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  const expected = crypto
    .createHmac('sha256', secret)
    .update(parts.t + '.' + rawBody)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts.v1 || '', 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  // Reject replays of an old delivery.
  return Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t)) <= 300;
}

// Express: express.raw({ type: 'application/json' }) — NOT express.json(),
// the signature covers the exact bytes we sent.
app.post('/hooks/support', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verifyWebhook(raw, req.get('${SIGNATURE_HEADER}') || '', process.env.SUPPORT_WEBHOOK_SECRET!)) {
    return res.status(400).send('bad signature');
  }
  const event = JSON.parse(raw);
  res.json({ received: true });   // acknowledge first, work after
  handleEvent(event);             // ticket.created, ticket.response_sent, …
});`}</code>
          </pre>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">
            Contact form → ticket (no client needed)
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-3">
            For plain intake from your own forms, post straight to the inbound endpoint. Replies
            (<span className="font-mono">Re:</span>/<span className="font-mono">Sv:</span>) join the
            customer&apos;s existing ticket instead of opening a new one.
          </p>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`curl -X POST ${appDomain}/api/webhook/ticket \\
  -H "X-API-Key: $${envVar}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "customer@example.com",
    "name": "John Doe",
    "subject": "Order #1234",
    "message": "Where is my order?"
  }'`}</code>
          </pre>
        </div>
      </section>

      {/* Logged-in chatbot token */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">
          Logged-in chatbot — signing identity tokens
        </h2>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          To run the chat widget in logged-in mode (answering about the customer&apos;s own account),
          your backend mints a short-lived signed token after the customer logs in — Node&apos;s
          built-in <span className="font-mono">crypto</span> and the shared{' '}
          <span className="font-mono">IDENTITY_TOKEN_SECRET</span>, nothing else. See{' '}
          <a href="/developer/docs#logged-in-chatbot" className="text-[#7C5CFF] hover:underline">
            the full guide
          </a>{' '}
          for embedding and the endpoint reference.
        </p>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
          <code>{`const crypto = require('crypto');

// Mint after the customer authenticates, then hand to the widget via
// window.kbWidget.setIdentityToken(token).
function signIdentityToken(email, secret = process.env.IDENTITY_TOKEN_SECRET, ttlSeconds = 900) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { email: email.trim().toLowerCase(), iat: now, exp: now + ttlSeconds };
  const b64 = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('hex');
  return b64 + '.' + sig;
}`}</code>
        </pre>
      </section>
    </div>
  );
}
