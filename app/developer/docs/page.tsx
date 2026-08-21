import { headers } from 'next/headers';
import { product } from '@/lib/products';
import { resolveTenantFromHeaders } from '@/lib/products/tenant';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events';
import { SIGNATURE_HEADER, SIGNATURE_TOLERANCE_SECONDS } from '@/lib/webhooks/signature';

export default async function ApiDocsPage() {
  await resolveTenantFromHeaders();
  // Derive the real deployment origin from the request so every example URL
  // (API base, help center, widget) matches the domain the admin is actually
  // on — e.g. https://doldadress.successifier.com — instead of a guessed
  // placeholder.
  const h = await headers();
  const host = h.get('host') ?? `your-subdomain.${product.apiBaseDomain}`;
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const appDomain = `${proto}://${host}`;
  const keyExample = `${product.apiKeyPrefix}_your_api_key_here`;
  const baseUrl = `${appDomain}/api`;
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">API Documentation</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Complete reference for the {product.displayName} Support API
        </p>
      </div>

      {/* Authentication */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Authentication</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          All API requests require authentication using an API key. Include your API key in the request header:
        </p>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
          <code>{`X-API-Key: ${keyExample}

# Or using Authorization header
Authorization: Bearer ${keyExample}`}</code>
        </pre>
      </section>

      {/* Base URL */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Base URL</h2>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg">
          <code>{baseUrl}</code>
        </pre>
      </section>

      {/* Machine-readable spec */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Machine-readable spec</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          The whole API — endpoints, schemas and the outbound webhook events — is described as
          OpenAPI 3.1 at <span className="font-mono">GET /api/openapi</span>. Import it into
          Postman or Insomnia, or generate a client from it. It is served behind the same API key
          you are about to use, so tooling can fetch it directly:
        </p>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
          <code>{`curl -H "X-API-Key: ${keyExample}" \\
  ${appDomain}/api/openapi -o support-api.json`}</code>
        </pre>
      </section>

      {/* Help Center & AI Chatbot on your own site */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Help Center &amp; AI Chatbot on your own site
          </h2>
          <p className="text-slate-600 dark:text-slate-400">
            The knowledge base powers a public help center and an AI chatbot you can add to your
            own website. Everything here is <strong>read-only and needs no API key</strong> — it
            serves only articles you have marked <strong>Published</strong> and <strong>Public</strong>.
            Internal and auto-learned articles (which may contain customer data) are never exposed.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Step 1 — Publish the articles you want visible
          </h3>
          <p className="text-slate-600 dark:text-slate-400">
            In <span className="font-mono">Knowledge</span>, set an article&apos;s status to{' '}
            <span className="font-mono">Published</span> and toggle it <span className="font-mono">Public</span>.
            Only those articles appear in the help center, in search, and as chatbot answers.
            You can style the help center under <span className="font-mono">Knowledge → Design</span>.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Step 2 — Add the widget (chatbot + search)
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-3">
            Paste this snippet before <span className="font-mono">&lt;/body&gt;</span> on your site. It
            injects a floating <strong>Help</strong> button with an <strong>Ask AI</strong> tab (the
            chatbot, answering only from your published articles and linking its sources) and a{' '}
            <strong>Search</strong> tab.
          </p>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`<script src="${appDomain}/kb-widget.js"
        data-kb-base="${appDomain}"></script>`}</code>
          </pre>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Alternative — link the hosted help center
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-3">
            Prefer no code? Link straight to the ready-made, server-rendered help center:
          </p>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`${appDomain}/help            # start page with search + categories
${appDomain}/help/c/<category>  # category page
${appDomain}/help/<slug>        # a single article
${appDomain}/help/sitemap.xml   # for search-engine indexing`}</code>
          </pre>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Public help center API (no key, CORS-enabled)
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-3">
            Want full control over the design? Build your own UI against these endpoints. CORS is
            allowed for your product domains.
          </p>
          <div className="space-y-2 mb-4">
            <div className="flex gap-2 flex-wrap">
              <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">GET /api/public/kb/categories</code>
              <span className="text-slate-600 dark:text-slate-400">Public categories with article counts</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">GET /api/public/kb/articles?category=&amp;page=</code>
              <span className="text-slate-600 dark:text-slate-400">List published articles</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">GET /api/public/kb/articles/&lt;slug&gt;</code>
              <span className="text-slate-600 dark:text-slate-400">A single article (full content + related)</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">GET /api/public/kb/search?q=</code>
              <span className="text-slate-600 dark:text-slate-400">Full-text search over published articles</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">POST /api/public/kb/chat</code>
              <span className="text-slate-600 dark:text-slate-400">AI chatbot, grounded only in published articles</span>
            </div>
          </div>

          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Chatbot request</h4>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto mb-3">
            <code>{`POST ${appDomain}/api/public/kb/chat
Content-Type: application/json

{
  "question": "How do I change my address?",
  "history": [
    { "role": "user", "content": "previous question" },
    { "role": "assistant", "content": "previous answer" }
  ]
}`}</code>
          </pre>
          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Streaming response (NDJSON, one JSON object per line)
          </h4>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`{"type":"delta","text":"You can change "}
{"type":"delta","text":"your address under My Pages…"}
{"type":"done","sources":[{"slug":"andra-adress","title":"Ändra adress"}]}`}</code>
          </pre>
          <p className="text-slate-600 dark:text-slate-400 mt-3">
            Read the body as a stream and append each <span className="font-mono">delta.text</span> as it
            arrives; the final <span className="font-mono">done</span> event carries the source articles
            the answer was based on. If the knowledge base can&apos;t answer, the bot says so instead of
            guessing. The endpoint is rate-limited to 12 requests/min per IP.
          </p>
        </div>
      </section>

      {/* Logged-in chatbot */}
      <section id="logged-in-chatbot" className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5 scroll-mt-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Logged-in chatbot (answers about the customer&apos;s own account)
          </h2>
          <p className="text-slate-600 dark:text-slate-400">
            The same chat widget can run in <strong>logged-in mode</strong> on your site. On top of the
            public help center it then also answers a signed-in customer&apos;s questions about{' '}
            <strong>their own account</strong> — subscription, invoices, payments — by reading live data
            from your connected systems (Stripe, Billecta, Retool, Resend) for that customer.
            It is <strong>read-only</strong>: it never changes anything on the account.
          </p>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Because the widget runs in the visitor&apos;s browser, the chat never trusts an email sent
            from the browser. Instead <strong>your backend</strong> signs a short-lived token after the
            customer logs in, and the endpoint reads the email from the <em>signed</em> payload — so a
            customer can only ever see their own data.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Step 1 — Set the shared secret
          </h3>
          <p className="text-slate-600 dark:text-slate-400">
            A single secret, <span className="font-mono">IDENTITY_TOKEN_SECRET</span> (≥ 32 chars), is
            shared between your backend and this deployment. It is configured together with your{' '}
            {product.displayName} contact and is <strong>never shown in this portal</strong>. Until it
            is set, logged-in mode stays disabled and the widget behaves as the public chatbot.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Step 2 — Mint a token on your backend (after login)
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-3">
            Token format: <span className="font-mono">base64url(payload).hex(HMAC-SHA256(payload, secret))</span>{' '}
            where the payload is <span className="font-mono">{`{ email, iat, exp }`}</span> (seconds since
            epoch). Keep the lifetime short and mint a fresh token per session.
          </p>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`const crypto = require('crypto');

function signIdentityToken(email, secret, ttlSeconds = 900) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { email: email.trim().toLowerCase(), iat: now, exp: now + ttlSeconds };
  const b64 = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('hex');
  return b64 + '.' + sig;
}`}</code>
          </pre>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Step 3 — Hand the token to the widget
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-3">
            Either set it on the widget script, or (recommended, since tokens expire) update it from your
            app whenever you mint a fresh one. With a token present the widget talks to{' '}
            <span className="font-mono">/api/me/chat</span>; without one it stays fully public.
          </p>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto mb-3">
            <code>{`<script src="${appDomain}/kb-widget.js"
        data-kb-base="${appDomain}"
        data-identity-token="<token minted server-side>"></script>`}</code>
          </pre>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`// Refresh the token at runtime (recommended)
window.kbWidget.setIdentityToken(freshTokenFromYourBackend);`}</code>
          </pre>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Calling the endpoint directly
          </h3>
          <div className="flex gap-2 flex-wrap mb-3">
            <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">POST /api/me/chat</code>
            <span className="text-slate-600 dark:text-slate-400">
              Authenticated by the signed token in the <span className="font-mono">X-Identity-Token</span> header
            </span>
          </div>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto mb-3">
            <code>{`POST ${appDomain}/api/me/chat
X-Identity-Token: <signed token>
Content-Type: application/json

{
  "question": "När förnyas min prenumeration?",
  "history": []
}`}</code>
          </pre>
          <p className="text-slate-600 dark:text-slate-400 mb-3">
            The response is the same streaming NDJSON contract as the public chatbot
            (<span className="font-mono">delta</span> events then a final <span className="font-mono">done</span>{' '}
            event with source articles). An invalid or expired token returns{' '}
            <span className="font-mono">401</span>. The endpoint is rate-limited to 12 requests/min per
            customer.
          </p>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`{"type":"delta","text":"Din prenumeration förnyas "}
{"type":"delta","text":"den 3 juli 2026."}
{"type":"done","sources":[]}`}</code>
          </pre>
        </div>
      </section>

      {/* Endpoints */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Endpoints</h2>
        <p className="text-slate-600 dark:text-slate-400">
          The endpoints below are the authenticated Support API (they require an API key).
        </p>

        {/* Create Ticket */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 border border-green-300 text-green-700 dark:border-green-700 dark:text-green-300 rounded font-mono text-sm font-semibold">
              POST
            </span>
            <code className="text-lg font-mono text-slate-900 dark:text-slate-100">/tickets</code>
          </div>
          
          <p className="text-slate-600 dark:text-slate-400 mb-4">Create a new support ticket</p>
          
          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Request Body</h4>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto mb-4">
            <code>{`{
  "customerEmail": "customer@example.com",   // required
  "customerName": "John Doe",                // optional
  "subject": "Need help with billing",       // required
  "originalMessage": "I have a question about my invoice...", // required
  "priority": "normal"                       // optional: low, normal, high, urgent
}`}</code>
          </pre>

          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Response</h4>
          <p className="text-slate-600 dark:text-slate-400 mb-2 text-sm">
            The ticket is returned immediately with <code className="font-mono">aiResponse: null</code>.
            The AI draft is generated asynchronously and filled in shortly after — fetch the ticket
            again to read it.
          </p>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`{
  "id": "cmlb49srj00003se5j3w",
  "tenantId": "cmlb49srj00003se5",
  "customerEmail": "customer@example.com",
  "customerName": "John Doe",
  "subject": "Need help with billing",
  "status": "new",
  "priority": "normal",
  "originalMessage": "I have a question about my invoice...",
  "aiResponse": null,
  "aiConfidence": null,
  "createdAt": "2026-02-11T15:30:00.000Z",
  "updatedAt": "2026-02-11T15:30:00.000Z"
}`}</code>
          </pre>
        </div>

        {/* List Tickets */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 border border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300 rounded font-mono text-sm font-semibold">
              GET
            </span>
            <code className="text-lg font-mono text-slate-900 dark:text-slate-100">/tickets</code>
          </div>
          
          <p className="text-slate-600 dark:text-slate-400 mb-4">Retrieve all tickets</p>
          
          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Query Parameters</h4>
          <div className="space-y-2 mb-4">
            <div className="flex gap-2">
              <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">status</code>
              <span className="text-slate-600 dark:text-slate-400">Pass <code className="font-mono">archived</code> to list archived tickets; otherwise archived tickets are excluded</span>
            </div>
            <div className="flex gap-2">
              <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">since</code>
              <span className="text-slate-600 dark:text-slate-400">ISO timestamp — returns only tickets changed since then (delta poll)</span>
            </div>
          </div>

          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Response</h4>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`{
  "tickets": [
    {
      "id": "cmlb49srj00003se5j3w",
      "customerEmail": "customer@example.com",
      "subject": "Need help with billing",
      "status": "new",
      "priority": "normal",
      "createdAt": "2026-02-11T15:30:00.000Z"
    }
  ]
}`}</code>
          </pre>
        </div>

        {/* Get Ticket */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 border border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300 rounded font-mono text-sm font-semibold">
              GET
            </span>
            <code className="text-lg font-mono text-slate-900 dark:text-slate-100">/tickets/:id</code>
          </div>
          
          <p className="text-slate-600 dark:text-slate-400 mb-4">Retrieve a specific ticket by ID</p>
          
          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Response</h4>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`{
  "id": "cmlb49srj00003se5j3w",
  "customerEmail": "customer@example.com",
  "customerName": "John Doe",
  "subject": "Need help with billing",
  "status": "new",
  "priority": "normal",
  "originalMessage": "I have a question about my invoice...",
  "aiResponse": "Thank you for reaching out...",
  "aiConfidence": 0.92,
  "contextData": {
    "stripe": { "customerId": "cus_123" }
  },
  "createdAt": "2026-02-11T15:30:00.000Z",
  "updatedAt": "2026-02-11T15:30:00.000Z"
}`}</code>
          </pre>
        </div>

        {/* Update Ticket */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 border border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-300 rounded font-mono text-sm font-semibold">
              PATCH
            </span>
            <code className="text-lg font-mono text-slate-900 dark:text-slate-100">/tickets/:id</code>
          </div>
          
          <p className="text-slate-600 dark:text-slate-400 mb-4">Update a ticket</p>
          
          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Request Body</h4>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`{
  "status": "in_progress",
  "priority": "high",
  "finalResponse": "Custom response text..."
}`}</code>
          </pre>
        </div>

        {/* Send Response */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 border border-green-300 text-green-700 dark:border-green-700 dark:text-green-300 rounded font-mono text-sm font-semibold">
              POST
            </span>
            <code className="text-lg font-mono text-slate-900 dark:text-slate-100">/tickets/:id/send</code>
          </div>
          
          <p className="text-slate-600 dark:text-slate-400 mb-4">Send a response to the customer</p>
          
          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Request Body</h4>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`{
  "response": "Thank you for contacting us..."
}`}</code>
          </pre>
        </div>

        {/* Inbound webhook */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 border border-green-300 text-green-700 dark:border-green-700 dark:text-green-300 rounded font-mono text-sm font-semibold">
              POST
            </span>
            <code className="text-lg font-mono text-slate-900 dark:text-slate-100">/webhook/ticket</code>
          </div>

          <p className="text-slate-600 dark:text-slate-400 mb-4">
            Inbound intake for your own systems (contact forms, an order flow, another
            helpdesk). Same effect as <code className="font-mono">POST /tickets</code>, but with a
            flatter body and built-in threading: a subject starting with{' '}
            <code className="font-mono">Re:</code>/<code className="font-mono">Sv:</code> reopens the
            customer&apos;s matching ticket instead of creating a new one, and repeats of the same
            message within 10 minutes are merged rather than duplicated. Rate-limited to 30
            requests/min per IP.
          </p>

          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Request Body</h4>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto mb-4">
            <code>{`{
  "email": "customer@example.com",  // required
  "name": "John Doe",               // optional
  "subject": "Order #1234",         // required
  "message": "Where is my order?",  // required
  "priority": "normal"              // optional: low, normal, high, urgent
}`}</code>
          </pre>

          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Response</h4>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`{
  "success": true,
  "ticketId": "cmlb49srj00003se5j3w",
  "merged": false   // true when the message joined an existing ticket
}`}</code>
          </pre>
        </div>
      </section>

      {/* Outbound webhooks */}
      <section id="webhooks" className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5 scroll-mt-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Webhooks (events pushed to you)
          </h2>
          <p className="text-slate-600 dark:text-slate-400">
            Register an HTTPS endpoint under{' '}
            <a href="/developer/webhooks" className="text-[#7C5CFF] hover:underline">
              Developer → Webhooks
            </a>{' '}
            and we POST a signed JSON envelope to it whenever a ticket changes — so your CRM,
            Slack bot or order system stays in sync without polling{' '}
            <span className="font-mono">/api/tickets</span>. Each endpoint gets its own signing
            secret, shown once when you create or rotate it.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Events</h3>
          <div className="space-y-2">
            {WEBHOOK_EVENTS.map((event) => (
              <div key={event.type} className="flex gap-2 flex-wrap">
                <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">{event.type}</code>
                <span className="text-slate-600 dark:text-slate-400">{event.description}</span>
              </div>
            ))}
          </div>
          <p className="text-slate-600 dark:text-slate-400 mt-3">
            An endpoint with no events selected receives all of them, including event types added
            later. <span className="font-mono">ticket.created</span> always carries{' '}
            <span className="font-mono">aiResponse: null</span> — the draft is generated
            asynchronously and announced by{' '}
            <span className="font-mono">ticket.ai_response_generated</span>.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Request we send</h3>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`POST https://your-server.example.com/hooks/support
Content-Type: application/json
${SIGNATURE_HEADER}: t=1755777600,v1=6c4f…
X-Successifier-Event: ticket.created
X-Successifier-Delivery: evt_9f1c2b7d0a4e

{
  "id": "evt_9f1c2b7d0a4e",
  "type": "ticket.created",
  "createdAt": "2026-08-21T09:15:00.000Z",
  "tenantId": "cmlb49srj00003se5",
  "data": {
    "id": "cmlb49srj00003se5j3w",
    "customerEmail": "customer@example.com",
    "customerName": "John Doe",
    "subject": "Need help with billing",
    "status": "new",
    "priority": "normal",
    "category": null,
    "originalMessage": "I have a question about my invoice...",
    "aiResponse": null,
    "aiConfidence": null,
    "finalResponse": null,
    "assignedTo": null,
    "sentBy": null,
    "sentAt": null,
    "createdAt": "2026-08-21T09:15:00.000Z",
    "updatedAt": "2026-08-21T09:15:00.000Z"
  }
}`}</code>
          </pre>
          <p className="text-slate-600 dark:text-slate-400 mt-3">
            The ticket&apos;s <span className="font-mono">contextData</span> (records fetched from
            your connected systems, mail attachments) is deliberately <strong>not</strong> in the
            payload. Read it from <span className="font-mono">GET /api/tickets/:id</span> with an
            API key if you need it.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Verifying the signature</h3>
          <p className="text-slate-600 dark:text-slate-400 mb-3">
            The header is <span className="font-mono">t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</span>,
            where the HMAC-SHA256 is taken over{' '}
            <span className="font-mono">&quot;&lt;t&gt;.&lt;raw request body&gt;&quot;</span> with your
            endpoint secret. Verify against the <strong>raw</strong> body — re-serializing parsed
            JSON changes the bytes and the signature will not match.
          </p>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`const crypto = require('crypto');
const express = require('express');

const app = express();
const SECRET = process.env.SUPPORT_WEBHOOK_SECRET;

// Raw body — required for signature verification.
app.post('/hooks/support', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('${SIGNATURE_HEADER}') || '';
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  const body = req.body.toString('utf8');

  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(parts.t + '.' + body)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts.v1 || '', 'utf8');
  const signatureOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  // Reject anything older than ${SIGNATURE_TOLERANCE_SECONDS}s so a captured delivery can't be replayed.
  const fresh = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t)) <= ${SIGNATURE_TOLERANCE_SECONDS};

  if (!signatureOk || !fresh) return res.status(400).send('bad signature');

  const event = JSON.parse(body);
  // Acknowledge first, do the slow work afterwards.
  res.json({ received: true });

  switch (event.type) {
    case 'ticket.created':
      console.log('New ticket:', event.data.id);
      break;
    case 'ticket.ai_response_generated':
      console.log('AI draft ready:', event.data.aiResponse);
      break;
    case 'ticket.response_sent':
      console.log('Reply sent to', event.data.customerEmail);
      break;
  }
});

app.listen(3000);`}</code>
          </pre>
        </div>

        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Delivery, retries and failures</h3>
          <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-400">
            <li>Answer with any <span className="font-mono">2xx</span> within 10 seconds. Anything else counts as a failure.</li>
            <li>
              Failed deliveries are retried twice (after 1s and 3s). A <span className="font-mono">4xx</span> other
              than <span className="font-mono">429</span> is treated as &quot;this request is wrong&quot; and is not retried.
            </li>
            <li>
              Deliveries are at-least-once. Use the envelope&apos;s <span className="font-mono">id</span> to make your
              handler idempotent — a retry reuses the same id.
            </li>
            <li>
              After 15 consecutive failures an endpoint is disabled automatically. It stays listed in the portal with
              the last error, and re-enabling it resumes deliveries.
            </li>
            <li>
              The last 50 deliveries per endpoint — payload, response code and error — are visible under{' '}
              <a href="/developer/webhooks" className="text-[#7C5CFF] hover:underline">Developer → Webhooks</a>,
              together with a <strong>Send test</strong> button that delivers a{' '}
              <span className="font-mono">ping</span> event.
            </li>
            <li>
              Redirects are not followed, and the endpoint&apos;s hostname must resolve to a public address —
              checked before every delivery, not only at registration.
            </li>
            <li>Rotating an endpoint&apos;s secret invalidates the old one immediately, so roll it out on your side first.</li>
          </ul>
        </div>
      </section>

      {/* Error Codes */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Error Codes</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">400</code>
            <span className="text-slate-600 dark:text-slate-400">Bad Request - Invalid parameters</span>
          </div>
          <div className="flex gap-3">
            <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">401</code>
            <span className="text-slate-600 dark:text-slate-400">Unauthorized - Invalid or missing API key</span>
          </div>
          <div className="flex gap-3">
            <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">404</code>
            <span className="text-slate-600 dark:text-slate-400">Not Found - Resource doesn't exist</span>
          </div>
          <div className="flex gap-3">
            <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">500</code>
            <span className="text-slate-600 dark:text-slate-400">Internal Server Error</span>
          </div>
        </div>
      </section>

      {/* Rate Limiting */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Rate Limiting</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          There is no global per-key limit. Specific expensive endpoints are rate-limited per client
          IP; exceeding a limit returns <code className="font-mono">429 Too Many Requests</code> with a{' '}
          <code className="font-mono">Retry-After</code> header (in seconds). Current limits:
        </p>
        <div className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">POST /tickets/:id/send</code>
            <span className="text-slate-600 dark:text-slate-400">30 / min</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">GET /api/public/kb/search</code>
            <span className="text-slate-600 dark:text-slate-400">60 / min</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">POST /api/public/kb/chat</code>
            <span className="text-slate-600 dark:text-slate-400">12 / min</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">POST /api/me/chat</code>
            <span className="text-slate-600 dark:text-slate-400">12 / min (per logged-in customer)</span>
          </div>
        </div>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto mt-4">
          <code>{`HTTP/1.1 429 Too Many Requests
Retry-After: 42`}</code>
        </pre>
      </section>
    </div>
  );
}
