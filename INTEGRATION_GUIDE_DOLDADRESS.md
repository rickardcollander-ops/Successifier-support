# Successifier Integration Guide for Doldadress

This document outlines the complete technical integration steps for connecting Doldadress with the Successifier platform.

---

## Table of Contents

1. [Overview](#overview)
2. [Integration Architecture](#integration-architecture)
3. [Step 1: API Key Setup](#step-1-api-key-setup)
4. [Step 2: Configure Integrations](#step-2-configure-integrations)
5. [Step 3: Webhook Integration](#step-3-webhook-integration)
6. [Step 4: Knowledge Base Population](#step-4-knowledge-base-population)
7. [Step 5: Gmail / Email Integration](#step-5-gmail--email-integration)
8. [Step 6: Testing & Validation](#step-6-testing--validation)
9. [Authentication & Security](#authentication--security)
10. [API Reference](#api-reference)
11. [Data Formats & Structures](#data-formats--structures)
12. [GDPR & Data Handling](#gdpr--data-handling)

---

## Overview

Successifier is an AI-powered customer support platform that:
- Automatically converts incoming emails into support tickets
- Aggregates customer context from external services (Stripe, Billecta, Gmail, Resend, Retool)
- Generates AI responses (GPT-4) using knowledge base articles and customer context
- Provides a review workflow for support agents before sending responses
- Learns from agent feedback to continuously improve AI quality

### What Doldadress needs to provide:

| Component | Purpose | Priority |
|-----------|---------|----------|
| **Stripe API Key** | Subscription & invoice context | Required |
| **Billecta Credentials** | Swedish invoice data | Required |
| **Gmail OAuth** | Email inbox sync & sending | Required |
| **Knowledge Base Articles** | AI training data | Required |
| **Webhook Endpoint** (optional) | External ticket creation | Optional |
| **Resend API Key** (optional) | Email delivery tracking | Optional |
| **Retool API** (optional) | Custom business data | Optional |

---

## Integration Architecture

```
                    ┌─────────────────────────────────┐
                    │        Successifier Platform      │
                    │                                   │
  Incoming Email ──►│  Gmail Sync ──► Ticket Creation   │
                    │       │                           │
                    │       ▼                           │
  Webhook ────────►│  Context Aggregator               │
                    │    ├── Stripe (subscriptions)     │
                    │    ├── Billecta (invoices)        │
                    │    ├── Resend (email history)     │
                    │    └── Retool (custom data)       │
                    │       │                           │
                    │       ▼                           │
                    │  AI Response Generator (GPT-4)    │
                    │    ├── Knowledge Base matching    │
                    │    ├── Customer context           │
                    │    └── Learning from feedback     │
                    │       │                           │
                    │       ▼                           │
                    │  Agent Review ──► Send Response   │
                    └─────────────────────────────────┘
```

---

## Step 1: API Key Setup

### 1.1 Generate API Key in Developer Portal

1. Log in to the Successifier dashboard
2. Navigate to **Developer Portal** (`/developer`)
3. Click **"Create API Key"**
4. Name it (e.g., `Doldadress Production`)
5. Copy the generated key immediately (format: `dold_<32 chars>`)
6. Store securely - the key won't be shown again

### 1.2 Authentication

All API requests require the API key in one of these headers:

```http
X-API-Key: dold_your_api_key_here
```

or

```http
Authorization: Bearer dold_your_api_key_here
```

### 1.3 Base URL

```
https://doldadress.successifier.com/api
```

---

## Step 2: Configure Integrations

Navigate to **Settings** (`/settings`) in the dashboard to configure each integration.

### 2.1 Stripe Integration

**Required credentials:**
```json
{
  "apiKey": "sk_live_..."
}
```

**What Successifier fetches:**
- Customer lookup by email
- Active subscriptions (status, plan, period end date)
- Invoice history (paid/unpaid, amounts, dates)
- Recent charges

**Data used in AI context:**
- Active subscription details to answer plan-related questions
- Unpaid invoices to address billing inquiries
- Payment history for dispute resolution

### 2.2 Billecta Integration

**Required credentials:**
```json
{
  "apiKey": "your_billecta_api_key",
  "creditorPublicId": "your_creditor_public_id"
}
```

**What Successifier fetches:**
- Debtor search by email
- Open/closed invoices
- Invoice amounts, due dates, payment status
- Delivery method (Kivra, email, etc.)

### 2.3 Resend Integration (Optional)

**Required credentials:**
```json
{
  "apiKey": "re_...",
  "fromEmail": "support@doldadress.se"
}
```

**What Successifier fetches:**
- Email delivery history per customer
- Recent email subjects and dates

### 2.4 Retool Integration (Optional)

**Required credentials:**
```json
{
  "apiKey": "your_retool_workflow_api_key",
  "workflowUrl": "https://api.retool.com/v1/workflows/<workflow-id>/startTrigger"
}
```

**How it works:**
- Data is fetched from a **Retool Workflow** exposed via its webhook/API trigger URL.
- The workflow is called with `POST` and the Workflow API key in the
  `X-Workflow-Api-Key` header. The customer email is sent in the JSON body:
  `{ "email": "customer@example.com" }`.
- The workflow should look up the customer and return their data. Responses
  wrapped in `{ "data": ... }` (the public API trigger format) are unwrapped
  automatically; an empty result is treated as "no customer found".

**What Successifier fetches:**
- Custom customer data via Retool workflows (any fields the workflow returns).
- The data is shown on the ticket's Retool card **and** included in the
  context passed to the AI when drafting replies.

> Legacy note: the older `workspaceUrl` credential is still accepted as a
> fallback for `workflowUrl`, but new setups should use `workflowUrl`.

---

## Step 3: Webhook Integration

### 3.1 Inbound Webhook (Create Tickets from External Sources)

If Doldadress has contact forms, chatbots, or other external sources that should create tickets:

**Endpoint:** `POST /api/webhook/ticket`

**Request Body:**
```json
{
  "email": "customer@example.com",
  "name": "Customer Name",
  "subject": "Support request subject",
  "message": "The full message content...",
  "priority": "normal"
}
```

**Required fields:** `email`, `subject`, `message`
**Optional fields:** `name`, `priority` (low | normal | high | urgent)

**Response:**
```json
{
  "success": true,
  "ticketId": "cmlb49srj00003se5j3w"
}
```

**Note:** The webhook automatically triggers context aggregation from all active integrations.

### 3.2 Outbound Webhooks (Receive Ticket Events)

Successifier can notify your systems when ticket events occur. Configure a webhook URL in settings to receive:

```json
{
  "type": "ticket.created",
  "data": {
    "id": "ticket_id",
    "customerEmail": "customer@example.com",
    "subject": "...",
    "status": "new"
  }
}
```

**Event types:**
- `ticket.created` - New ticket created
- `ticket.updated` - Ticket status/priority changed
- `ticket.ai_response_generated` - AI response is ready for review

---

## Step 4: Knowledge Base Population

The knowledge base is critical for AI response quality. Successifier uses it as the primary source for generating customer responses.

### 4.1 Structure

Each article should include:

```json
{
  "title": "How to cancel my subscription",
  "content": "Full answer text in Swedish...",
  "category": "billing",
  "tags": ["avsluta", "prenumeration", "uppsägning", "cancel"],
  "isActive": true
}
```

### 4.2 Recommended Categories

| Category | Description | Example Topics |
|----------|-------------|----------------|
| `billing` | Invoices, payments, refunds | Faktura, betalning, återbetalning |
| `subscription` | Plans, upgrades, cancellations | Prenumeration, avsluta, uppgradera |
| `account` | Login, settings, profile | Konto, lösenord, inställningar |
| `shipping` | Delivery, tracking, returns | Leverans, spårning, retur |
| `general` | FAQ, policies, contact info | Öppettider, kontakt, villkor |

### 4.3 API Endpoints for Knowledge Base

**Create article:** `POST /api/knowledge`
```json
{
  "title": "Article title",
  "content": "Full article content...",
  "category": "billing",
  "tags": ["tag1", "tag2"]
}
```

**List articles:** `GET /api/knowledge`

**Update article:** `PUT /api/knowledge/:id`

**Delete article:** `DELETE /api/knowledge/:id`

### 4.4 Best Practices

- Write articles in **Swedish** (the AI responds in the detected language, defaulting to Swedish)
- Include common customer phrasings in tags for better matching
- Keep content factual and complete - the AI uses it verbatim as source material
- Add cancellation-specific articles with keywords: `avsluta`, `säga upp`, `avbryta`, `cancel`
- Update articles regularly based on AI feedback

---

## Step 5: Gmail / Email Integration

### 5.1 Gmail OAuth Setup

1. Navigate to **Settings > Email Accounts** (`/settings/email-accounts`)
2. Click **"Connect Gmail Account"**
3. Authorize with Google (requires Gmail read, modify, and send scopes)
4. The connected account will automatically sync unread emails into tickets

### 5.2 Required Google OAuth Scopes

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.send
```

### 5.3 Email Flow

1. **Inbound:** Gmail sync fetches unread inbox emails → Creates tickets with full thread context
2. **AI Processing:** Context is gathered from integrations → AI generates draft response
3. **Agent Review:** Support agent reviews AI response, edits if needed
4. **Outbound:** Response sent via Gmail (maintaining the original thread)

### 5.4 Sync Configuration

- Auto-sync runs on demand or can be scheduled
- Only processes inbox messages (not spam, sent, etc.)
- Duplicate detection prevents re-importing the same email
- Email thread content is extracted recursively for full conversation context

---

## Step 6: Testing & Validation

### 6.1 Test Each Integration

In **Settings** (`/settings`), each integration has a **"Test"** button that verifies:
- API credentials are valid
- Connection to external service works
- Data can be fetched successfully

### 6.2 Test Ticket Creation

**Via API:**
```bash
curl -X POST https://doldadress.successifier.com/api/webhook/ticket \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@doldadress.se",
    "name": "Test User",
    "subject": "Test ticket",
    "message": "This is a test message to verify the integration."
  }'
```

**Verify:**
1. Ticket appears in the dashboard (`/tickets`)
2. Context data is populated (check Stripe/Billecta data for the email)
3. AI response is generated using knowledge base
4. Response can be sent back via email

### 6.3 Test AI Response Quality

1. Create test tickets with common customer questions
2. Verify AI uses knowledge base articles correctly
3. Use thumbs up/down feedback to train the AI
4. Check that customer context (subscriptions, invoices) is referenced

---

## Authentication & Security

### API Key Security
- API keys use format: `dold_<32 random alphanumeric chars>`
- Keys are validated on every request
- Keys can be deactivated/deleted in the Developer Portal
- `lastUsedAt` is tracked for auditing

### Credential Encryption
- All integration credentials are encrypted at rest using **AES-256-GCM**
- Format: `iv:authTag:encryptedData` (hex-encoded)
- Encryption key is stored in environment variables, not in code

### Session Security
- User authentication via Google OAuth (NextAuth.js)
- JWT-based sessions
- Allowed domains: `doldadress.se`, `becomeanon.com`

### HTTPS
- All API communication must use HTTPS
- No plaintext HTTP endpoints in production

### Rate Limiting
- 100 requests per minute per API key
- Rate limit headers included in responses:
  ```
  X-RateLimit-Limit: 100
  X-RateLimit-Remaining: 95
  X-RateLimit-Reset: 1707667200
  ```

---

## API Reference

### Ticket Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tickets` | Create a new ticket |
| `GET` | `/api/tickets` | List all tickets (filter by `?status=` and `?priority=`) |
| `GET` | `/api/tickets/:id` | Get ticket details |
| `PUT` | `/api/tickets/:id` | Update ticket (status, priority, response) |
| `POST` | `/api/tickets/:id/send` | Send response to customer |
| `POST` | `/api/tickets/:id/generate-response` | Generate AI response |
| `DELETE` | `/api/tickets/:id/delete` | Delete ticket |
| `POST` | `/api/tickets/:id/spam` | Mark as spam |

### Knowledge Base Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/knowledge` | Create article |
| `GET` | `/api/knowledge` | List articles |
| `GET` | `/api/knowledge/:id` | Get article |
| `PUT` | `/api/knowledge/:id` | Update article |
| `DELETE` | `/api/knowledge/:id` | Delete article |

### Integration Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/integrations` | Save integration config |
| `GET` | `/api/integrations` | List all integrations |
| `PUT` | `/api/integrations/:id` | Update integration |
| `DELETE` | `/api/integrations/:id` | Delete integration |
| `POST` | `/api/integrations/:id/test` | Test integration credentials |

### Webhook

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/webhook/ticket` | Create ticket from external source |

---

## Data Formats & Structures

### Ticket Object

```json
{
  "id": "string",
  "tenantId": "string",
  "customerEmail": "string",
  "customerName": "string | null",
  "subject": "string",
  "status": "new | in_progress | waiting_ai | review | sent | closed | archived",
  "priority": "low | normal | high | urgent",
  "originalMessage": "string",
  "aiResponse": "string | null",
  "finalResponse": "string | null",
  "aiConfidence": "number (0-1) | null",
  "contextData": {
    "stripe": {
      "customerId": "string",
      "subscriptions": [{ "status": "string", "currentPeriodEnd": "number" }],
      "invoices": [{ "amount": "number", "paid": "boolean", "date": "string" }]
    },
    "billecta": {
      "invoices": [{ "number": "string", "amount": "number", "isPaid": "boolean", "dueDate": "string", "deliveryMethod": "string" }]
    }
  },
  "createdAt": "ISO 8601 datetime",
  "updatedAt": "ISO 8601 datetime"
}
```

### Integration Credentials Format

Each integration type requires specific credentials:

| Type | Required Fields |
|------|----------------|
| `stripe` | `apiKey` |
| `billecta` | `apiKey`, `creditorPublicId` |
| `gmail` | `clientId`, `clientSecret`, `refreshToken` |
| `resend` | `apiKey`, `fromEmail` |
| `retool` | `apiKey`, `workflowUrl` (legacy: `workspaceUrl`) |

---

## GDPR & Data Handling

### Data Processing

- Customer emails and ticket data are stored in PostgreSQL (Neon Serverless)
- AI responses are generated via OpenAI API (data processed but not stored by OpenAI)
- Integration data is fetched on-demand and stored in ticket context

### Data Retention

- Tickets and associated data are retained until manually deleted or archived
- Email sync data follows Gmail retention policies
- AI feedback data is retained for learning purposes

### Data Subject Rights

- **Export:** Customer data can be exported via the reports API
- **Deletion:** Tickets can be deleted individually or in bulk
- **Access:** All customer-related tickets are searchable by email

### Recommended Actions for Doldadress

1. Update your privacy policy to include Successifier as a data processor
2. Establish a Data Processing Agreement (DPA)
3. Ensure customer consent covers AI-assisted support responses
4. Configure data retention policies aligned with your requirements

---

## Support & Contact

For technical questions about the integration:
- **Email:** rc@successifier.com
- **Developer Portal:** `/developer` in your Successifier dashboard
- **API Docs:** `/developer/docs`
- **SDK Reference:** `/developer/sdk`
