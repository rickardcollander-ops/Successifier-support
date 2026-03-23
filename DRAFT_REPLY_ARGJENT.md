# Draft Email Reply to Argjent Sahiti

**To:** Argjent Sahiti
**Subject:** RE: Successifier Integration - Technical Guide & Next Steps

---

Hi Argjent,

Thanks for reaching out - great to hear you're ready to move forward on the technical side.

I've put together a comprehensive integration guide that covers everything your development team needs. I'll share it as an attached document, but here's a summary of the key steps:

## Integration Steps (in order)

### 1. API Credentials & Access
- Log in to the Successifier dashboard and generate an API key in the **Developer Portal** (`/developer`)
- API key format: `dold_<32 chars>`, used via `X-API-Key` header or `Authorization: Bearer` header
- Base URL: `https://doldadress.successifier.com/api`

### 2. Connect Your Data Sources (Settings > Integrations)
Your team needs to provide credentials for the following integrations:

| Integration | What We Need | What It Provides |
|-------------|-------------|-----------------|
| **Stripe** | API key (`sk_live_...`) | Subscription status, invoices, payment history |
| **Billecta** | API key + Creditor Public ID | Swedish invoicing data, unpaid invoices |
| **Gmail** | OAuth connection (done via dashboard) | Email inbox sync, sending responses |
| **Resend** *(optional)* | API key + from email | Email delivery tracking |
| **Retool** *(optional)* | API key + workspace URL | Custom business data |

Each integration has a **Test** button in settings to verify the connection works.

### 3. Populate the Knowledge Base
This is critical for AI response quality. Your team should create articles covering your most common support topics (billing, subscriptions, account issues, etc.). Articles should be in **Swedish** with relevant tags for matching.

API: `POST /api/knowledge` with `{ title, content, category, tags }`

### 4. Set Up Email Sync
Connect your support Gmail account via **Settings > Email Accounts**. This enables:
- Automatic ticket creation from incoming emails
- Sending AI-generated responses back via Gmail (maintaining threads)

### 5. Optional: Webhook for External Ticket Creation
If you have contact forms or other sources, send tickets to: `POST /api/webhook/ticket`

```json
{
  "email": "customer@example.com",
  "name": "Customer Name",
  "subject": "Subject",
  "message": "Message content",
  "priority": "normal"
}
```

## Security
- All credentials encrypted at rest (AES-256-GCM)
- HTTPS required for all API communication
- API rate limit: 100 requests/minute
- Google OAuth for user authentication (allowed domain: `doldadress.se`)

## GDPR
- We recommend updating your privacy policy and establishing a DPA
- Customer data export and deletion available via the API
- AI processing via OpenAI (no data retention on their side)

## What I Need From You
1. **Stripe API key** (live mode, read-only permissions sufficient)
2. **Billecta API key** and **Creditor Public ID**
3. **Gmail account** to use for support (connect via dashboard)
4. **Knowledge base content** - your FAQ articles, support policies, common answers
5. Confirm the **email domain** to whitelist for dashboard access

I've attached the full integration guide with detailed API references, data structures, and examples. Your developers can also access the interactive API docs and Node.js SDK reference directly in the dashboard.

Happy to schedule a call if your team has questions during implementation.

Best regards,
Rickard
