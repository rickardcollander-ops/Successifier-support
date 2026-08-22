// Shape of a product's customizable settings. Everything that differs
// between the products that share this codebase (Doldadress, Serus, …)
// lives here. Shared logic stays in one place and reads from the active
// product config, so a common change ships to every product at once while
// per-product values can still diverge.
//
// This file is import-safe from client components — keep it free of any
// server-only imports (no prisma, no node APIs).

export interface AgentColor {
  bg: string;
  border: string;
  text: string;
}

/** A sign-in method a tenant can offer. See ProductConfig.authProviders. */
export type AuthProvider = 'google' | 'resend';

export const AUTH_PROVIDERS: AuthProvider[] = ['google', 'resend'];

export interface ProductConfig {
  /**
   * Stable key for this product. By convention this equals BOTH the
   * Tenant.subdomain AND the Tenant.id row in the database, and the value
   * of the PRODUCT / NEXT_PUBLIC_PRODUCT env var for the deployment.
   */
  key: string;

  /** Brand name shown in the UI chrome (sidebar, page title, sign-in). */
  displayName: string;

  /** Brand name injected into the AI system prompt ("…medarbetare för X"). */
  brandName: string;

  /** Primary language for customer-facing output (AI replies, greeting,
   *  signature, autoresponder). 'sv' = Swedish, 'en' = English. */
  language: 'sv' | 'en';

  /** Generic support sign-off name, e.g. "Doldadress Kundtjänst". */
  supportName: string;

  /** Display name used in the From header of outgoing replies. */
  fromName: string;

  /** Prefix for generated API keys (e.g. "dold" → "dold_xxx"). */
  apiKeyPrefix: string;

  /** Public API base domain shown in the developer docs (e.g. "doldadress.com"). */
  apiBaseDomain: string;

  /** Integration types offered in Settings for this product (cards shown). */
  integrations: string[];

  /**
   * Show the "Drabbade kunder (stängd-ärende-buggen)" cleanup tool in Settings.
   * This is a Doldadress-specific diagnostic for a historical bug; off for
   * newer products that never had it.
   */
  showAffectedCustomersTool: boolean;

  /** Domains (besides superadmins) allowed to sign in. */
  allowedDomains: string[];

  /**
   * Which sign-in methods this tenant offers. The sign-in page renders a
   * button per entry and the auth callbacks reject any provider not listed
   * here, so turning one off closes the door rather than just hiding it.
   *
   *   'google' — Google Workspace / Gmail accounts (default)
   *   'resend' — magic link by e-mail, for customers on neither Google
   *              nor Microsoft. Requires an active Resend integration (or
   *              the platform AUTH_RESEND_KEY/AUTH_EMAIL_FROM env pair).
   *
   * A tenant should normally offer ONE method: with several enabled, the
   * weakest one defines the security of every account. Enable a second only
   * while migrating between them.
   */
  authProviders: AuthProvider[];

  /**
   * Whether anyone on an `allowedDomains` domain gets an account simply by
   * signing in (the historic behaviour), or whether an admin must invite
   * them first. Off = the User row is the single source of truth for who
   * may access the tenant, which is what you want for a customer whose
   * domain is shared with people outside the support team.
   */
  allowDomainAutoJoin: boolean;

  /**
   * Emails (besides the global superadmins) granted access to the Settings
   * area on THIS deployment — managing integrations, inbox tabs, users, etc.
   * Matched case-insensitively. Superadmins (SUPERADMIN_EMAILS) always have
   * access regardless of this list. Can be extended per deployment via the
   * SETTINGS_ADMIN_EMAILS env var.
   */
  adminEmails: string[];

  /** Agents who can be assigned tickets and are broken out in reports. */
  agents: string[];

  /**
   * Fixed category list for AI classification of incoming tickets
   * (lib/services/ticket-classifier.ts) and the "what do customers ask
   * about" report panel. Written in the product's language. Keep it short —
   * ~10 broad buckets classify far more reliably than a long specific list.
   * Should end with a catch-all ("övrigt"/"other").
   */
  ticketCategories: string[];

  /** Per-agent personal e-mail signature block. */
  agentSignatures: Record<string, string>;

  /** Per-agent avatar/label colors. */
  agentColors: Record<string, AgentColor>;

  /**
   * Whether to offer an on-demand "Translate" button on incoming customer
   * messages in the ticket view, translating them into the product's own
   * language. On for products whose customers often write in a different
   * language than the support team reads (e.g. Serus, English-speaking team
   * receiving French/German mail); off where customer and agent share a
   * language (e.g. Doldadress).
   */
  translateIncoming: boolean;

  /**
   * Whether to send the "we received your email" autoresponder when a
   * brand-new ticket is opened. Off for products that don't want an
   * automatic acknowledgement (e.g. Serus).
   */
  sendConfirmation: boolean;

  /**
   * A dedicated inbox folder that groups automated mail from a billing/
   * payment vendor so it doesn't clutter the normal customer queue
   * (Billecta for Doldadress, Stripe for Serus). The folder's internal
   * tab id stays "billecta" for backwards compatibility, but its label
   * and the sender addresses routed into it are product-specific.
   */
  vendorFolder: {
    /** Tab label shown in the ticket list (e.g. "Billecta", "Stripe"). */
    label: string;
    /** Lowercased sender addresses routed into this folder. */
    senders: string[];
  };

  /** Copy for the "we received your email" autoresponder. */
  confirmation: {
    /** Greeting line, e.g. "Hej,". */
    greeting: string;
    /**
     * Paragraphs shown between the greeting and the sign-off, in order.
     * Each entry is rendered as its own paragraph (blank line between).
     */
    bodyLines: string[];
    /** Sign-off block at the end (may span multiple lines). */
    signoff: string;
  };
}
