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

  /** Agents who can be assigned tickets and are broken out in reports. */
  agents: string[];

  /** Per-agent personal e-mail signature block. */
  agentSignatures: Record<string, string>;

  /** Per-agent avatar/label colors. */
  agentColors: Record<string, AgentColor>;

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
