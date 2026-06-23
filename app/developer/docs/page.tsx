import { headers } from 'next/headers';
import { product } from '@/lib/products';

export default async function ApiDocsPage() {
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
  "customerEmail": "customer@example.com",
  "customerName": "John Doe",
  "subject": "Need help with billing",
  "message": "I have a question about my invoice...",
  "priority": "normal" // optional: low, normal, high, urgent
}`}</code>
          </pre>

          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Response</h4>
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
  "aiResponse": "Thank you for reaching out...",
  "aiConfidence": 0.92,
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
              <span className="text-slate-600 dark:text-slate-400">Filter by status (new, in_progress, review, sent, closed)</span>
            </div>
            <div className="flex gap-2">
              <code className="text-sm bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">priority</code>
              <span className="text-slate-600 dark:text-slate-400">Filter by priority (low, normal, high, urgent)</span>
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
        <p className="text-slate-600 dark:text-slate-400">
          API requests are limited to 100 requests per minute per API key. Rate limit information is included in response headers:
        </p>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto mt-4">
          <code>{`X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1707667200`}</code>
        </pre>
      </section>
    </div>
  );
}
