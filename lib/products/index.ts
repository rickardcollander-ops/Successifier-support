import type { ProductConfig } from './types';
import { doldadress } from './doldadress';
import { serus } from './serus';

export type { ProductConfig, AgentColor } from './types';

// Registry of every product that shares this codebase. Add new products
// here (and create their config file alongside this one).
const PRODUCTS: Record<string, ProductConfig> = {
  doldadress,
  serus,
};

// Which product this deployment serves. Pin it per deploy via the env var
// (each product gets its own Vercel project + database). We read both the
// public and the server-only name so the same value resolves whether this
// module is bundled for the client or the server; NEXT_PUBLIC_PRODUCT is
// inlined at build time and is what reaches client components.
export const PRODUCT_KEY = (
  process.env.NEXT_PUBLIC_PRODUCT ||
  process.env.PRODUCT ||
  'doldadress'
)
  .trim()
  .toLowerCase();

if (!PRODUCTS[PRODUCT_KEY]) {
  console.warn(
    `[product] Unknown product "${PRODUCT_KEY}" (set PRODUCT / NEXT_PUBLIC_PRODUCT). Falling back to "doldadress".`,
  );
}

/** The active product configuration for this deployment. */
export const product: ProductConfig = PRODUCTS[PRODUCT_KEY] ?? doldadress;
