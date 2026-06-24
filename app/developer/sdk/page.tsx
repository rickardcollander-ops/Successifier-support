import { product } from '@/lib/products';

export default function SdkPage() {
  const pascal = product.displayName.replace(/[^A-Za-z0-9]/g, '');
  const pkg = `@${product.key}/sdk`;
  const clientClass = `${pascal}Client`;
  const errorClass = `${pascal}Error`;
  const envVar = `${product.key.toUpperCase()}_API_KEY`;
  const keyExample = `${product.apiKeyPrefix}_your_api_key_here`;
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">Node.js SDK</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Official Node.js SDK for the {product.displayName} Support API
        </p>
      </div>

      {/* Installation */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Installation</h2>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
          <code>{`npm install ${pkg}

# or with yarn
yarn add ${pkg}`}</code>
        </pre>
      </section>

      {/* Quick Start */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Quick Start</h2>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
          <code>{`import { ${clientClass} } from '${pkg}';

const client = new ${clientClass}({
  apiKey: '${keyExample}',
  subdomain: 'your-subdomain'
});

// Create a ticket
const ticket = await client.tickets.create({
  customerEmail: 'customer@example.com',
  customerName: 'John Doe',
  subject: 'Need help with billing',
  message: 'I have a question about my invoice...',
  priority: 'normal'
});

console.log('Ticket created:', ticket.id);
console.log('AI Response:', ticket.aiResponse);
console.log('Confidence:', ticket.aiConfidence);`}</code>
        </pre>
      </section>

      {/* Examples */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Examples</h2>

        {/* List Tickets */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">List Tickets</h3>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`// Get all tickets
const tickets = await client.tickets.list();

// Filter by status
const newTickets = await client.tickets.list({
  status: 'new'
});

// Filter by priority
const urgentTickets = await client.tickets.list({
  priority: 'urgent'
});`}</code>
          </pre>
        </div>

        {/* Get Ticket */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Get Ticket</h3>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`const ticket = await client.tickets.get('ticket_id');

console.log(ticket.subject);
console.log(ticket.status);
console.log(ticket.aiResponse);`}</code>
          </pre>
        </div>

        {/* Update Ticket */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Update Ticket</h3>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`const updated = await client.tickets.update('ticket_id', {
  status: 'in_progress',
  priority: 'high'
});`}</code>
          </pre>
        </div>

        {/* Send Response */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Send Response</h3>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`// Send AI-generated response
await client.tickets.send('ticket_id', {
  response: ticket.aiResponse
});

// Send custom response
await client.tickets.send('ticket_id', {
  response: 'Thank you for contacting us...'
});`}</code>
          </pre>
        </div>

        {/* Webhooks */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Webhooks</h3>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
            <code>{`import express from 'express';

const app = express();
app.use(express.json());

app.post('/webhooks/${product.key}', async (req, res) => {
  const event = req.body;
  
  switch (event.type) {
    case 'ticket.created':
      console.log('New ticket:', event.data.id);
      break;
    case 'ticket.updated':
      console.log('Ticket updated:', event.data.id);
      break;
    case 'ticket.ai_response_generated':
      console.log('AI response ready:', event.data.aiResponse);
      break;
  }
  
  res.json({ received: true });
});

app.listen(3000);`}</code>
          </pre>
        </div>
      </section>

      {/* TypeScript Support */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">TypeScript Support</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          The SDK is written in TypeScript and includes full type definitions:
        </p>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
          <code>{`import { ${clientClass}, Ticket, TicketStatus } from '${pkg}';

const client = new ${clientClass}({
  apiKey: process.env.${envVar}!,
  subdomain: 'your-subdomain'
});

const ticket: Ticket = await client.tickets.create({
  customerEmail: 'customer@example.com',
  subject: 'Support request',
  message: 'Need help...',
  priority: 'normal'
});

const status: TicketStatus = ticket.status; // Fully typed!`}</code>
        </pre>
      </section>

      {/* Error Handling */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Error Handling</h2>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
          <code>{`import { ${errorClass} } from '${pkg}';

try {
  const ticket = await client.tickets.create({
    customerEmail: 'invalid-email',
    subject: 'Test',
    message: 'Test message'
  });
} catch (error) {
  if (error instanceof ${errorClass}) {
    console.error('API Error:', error.message);
    console.error('Status Code:', error.statusCode);
    console.error('Error Code:', error.code);
  }
}`}</code>
        </pre>
      </section>

      {/* Logged-in chatbot token */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">
          Logged-in chatbot — signing identity tokens
        </h2>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          To run the chat widget in logged-in mode (answering about the customer&apos;s own account),
          your backend mints a short-lived signed token after the customer logs in. No SDK is needed —
          just Node&apos;s built-in <span className="font-mono">crypto</span> and the shared{' '}
          <span className="font-mono">IDENTITY_TOKEN_SECRET</span>. See{' '}
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

      {/* Manual Implementation */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Manual Implementation (Without SDK)</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          If you prefer not to use the SDK, you can make direct HTTP requests:
        </p>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto">
          <code>{`const fetch = require('node-fetch');

const apiKey = '${keyExample}';
const subdomain = 'your-subdomain';
const baseUrl = \`https://\${subdomain}.${product.apiBaseDomain}/api\`;

async function createTicket(data) {
  const response = await fetch(\`\${baseUrl}/tickets\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    throw new Error(\`API Error: \${response.statusText}\`);
  }
  
  return response.json();
}

// Usage
const ticket = await createTicket({
  customerEmail: 'customer@example.com',
  customerName: 'John Doe',
  subject: 'Need help',
  message: 'I have a question...',
  priority: 'normal'
});

console.log('Ticket created:', ticket.id);`}</code>
        </pre>
      </section>
    </div>
  );
}
