# Successifier Support

AI-powered, multi-tenant customer support platform — a sellable SaaS that
replaces Zendesk. One deployment and one database serve many customers
(tenants), each with their own branding, agents, integrations and AI
behavior.

Originally built as the internal Doldadress ticket system; now rebuilt as a
scalable platform. The original customers (Doldadress, Serus) run as tenants
on the same codebase.

## Multi-tenant architecture

- **Tenant resolution per request** (`lib/products/tenant.ts`): every request
  resolves its tenant in this order — session user's tenant → API key's
  tenant → host subdomain (`acme.successifier.app`) → legacy env pin
  (`PRODUCT`). The resolved config is installed in request context
  (AsyncLocalStorage), and the client gets it SSR-injected via
  `app/providers.tsx`.
- **Runtime configuration in the database** (`Tenant.settings` JSON):
  branding, language, support sign-offs, agents + signatures, enabled
  integrations, sign-in domain allowlists, autoresponder copy… All editable
  at runtime through the superadmin API — no redeploys per customer.
  Missing keys fall back to platform defaults (`lib/products/defaults.ts`)
  and, for the launch customers, their code preset (`lib/products/*.ts`).
- **`product` is a live view** (`lib/products/index.ts`): the historic
  `product.*` read sites now resolve against the ACTIVE tenant at call time.
  Never capture `product.x` in a module-level constant.

## Onboarding a new customer

```bash
node scripts/create-tenant.js acme "Acme AB" --admin anna@acme.se --domain acme.se
# …or, for a customer on neither Google nor Microsoft:
node scripts/create-tenant.js acme "Acme AB" --admin anna@acme.se --auth resend
```

This creates the tenant with sensible branding defaults, allowlists the
customer's email domain for sign-in and provisions their first admin user
(as an invitation — the account flips to active on their first sign-in).
The tenant is then served at `https://acme.<TENANT_ROOT_DOMAIN>` and
can be managed via:

- `GET/POST /api/admin/tenants` — list/create tenants (superadmin)
- `GET/PATCH /api/admin/tenants/:id` — read/update a tenant's settings and
  see the effective merged config (superadmin)

### Who may sign in

Access is decided by the `User` row, not by the sign-in provider — see
`lib/auth-policy.ts`, which both the NextAuth callback and the invite API
read so the rule can't drift between them:

- **Invited users** (a `User` row with this tenant's `tenantId`) always get
  in, whatever their e-mail domain. Settings → Users has the invite form;
  `POST /api/users` is the API.
- **Domain auto-join** additionally admits anyone on an `allowedDomains`
  domain. On by default (the historic behaviour); set
  `allowDomainAutoJoin: false` for a customer who wants strict invite-only.
- **Disabled accounts** (`User.status = 'disabled'`) are refused before any
  other rule can re-admit them, and their live sessions stop working within
  ~5 minutes — the JWT re-reads role, tenant and status from the database on
  that interval rather than trusting the token until it expires.

`authProviders` per tenant decides HOW they prove it: `['google']` (default)
or `['resend']` (magic link). A tenant should normally offer one method —
with two enabled, the weaker one sets the security level of every account.

## Quick Start (development)

1. **Install dependencies:**
```bash
npm install
```

2. **Set up environment variables** in `.env.local`:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/successifier"
ANTHROPIC_API_KEY="sk-ant-..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
AUTH_SECRET="..."
# Multi-tenant routing
TENANT_ROOT_DOMAIN="successifier.app"
# Optional legacy pin for single-tenant deployments
# PRODUCT="doldadress"
```

3. **Initialize database:**
```bash
npx prisma generate
npx prisma migrate deploy
```

4. **Create your first tenant:**
```bash
node scripts/create-tenant.js demo "Demo AB" --admin you@example.com
```

5. **Start development server:**
```bash
npm run dev
```

6. **Open:** http://localhost:3001

## Features

- ✅ **Tickets** — AI-drafted replies with knowledge-base grounding
- ✅ **Knowledge Base** — internal articles + public help center per tenant
- ✅ **Help Center** — branded, public, with AI chat per tenant
- ✅ **Reports** — analytics, ROI/value tracking per tenant
- ✅ **Gmail Integration** — email-to-ticket conversion
- ✅ **Public API + SDK** — per-tenant API keys (`/developer`)
- ✅ **Multi-tenant** — branding, agents, language & integrations per tenant

## Integrations (per tenant, toggled in settings)

- **Stripe** — payment and subscription data
- **Billecta** — invoice information
- **Resend** — email sending
- **Gmail** — email to ticket conversion
- **Retool** — custom data workflows

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Prisma (PostgreSQL)
- Anthropic Claude (AI replies, translation, KB chat)
- Tailwind CSS
- NextAuth v5 (Google sign-in)

## Documentation

- `DATABASE_SETUP.md` — database configuration and setup
- `GMAIL_SETUP.md` — Gmail OAuth integration guide
- `ADD_NEW_PRODUCT.md` — legacy per-deploy product setup (superseded by
  `scripts/create-tenant.js` for new customers)

## Project Structure

```
├── app/
│   ├── tickets/        # Ticket management
│   ├── knowledge/      # Knowledge base
│   ├── help/           # Public, branded help center
│   ├── reports/        # Analytics dashboard
│   ├── settings/       # Tenant settings (integrations, inbox, users)
│   ├── admin/          # Superadmin: tenant management
│   └── api/            # API routes
├── components/         # React components
├── lib/
│   ├── products/       # Tenant config: types, defaults, presets, resolver
│   ├── integrations/   # External service integrations
│   └── services/       # Business logic (AI, KB, email…)
└── prisma/             # Database schema + migrations
```
