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

  /** Domains (besides superadmins) allowed to sign in. */
  allowedDomains: string[];

  /** Agents who can be assigned tickets and are broken out in reports. */
  agents: string[];

  /** Per-agent personal e-mail signature block. */
  agentSignatures: Record<string, string>;

  /** Per-agent avatar/label colors. */
  agentColors: Record<string, AgentColor>;

  /** Copy for the "we received your email" autoresponder. */
  confirmation: {
    /** Body line containing the brand, e.g. "Tack för att du kontaktar …". */
    bodyLine: string;
    /** Sign-off name at the end of the autoresponder. */
    signoff: string;
  };
}
