import { product } from '@/lib/products';

// Server-only access helpers for the Settings/admin area. Settings is gated
// to a small allowlist — the deployment's product.adminEmails (e.g. Ida) plus
// the global superadmins — so regular agents can work tickets but only admins
// can change integrations, inbox tabs, users, etc.
//
// Do NOT import this from client components: it reads server-only env vars.
// Client code learns whether the current user is a settings admin from
// `session.user.isSettingsAdmin`, which the auth callbacks compute via this
// same helper.

function parseEmails(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Mirrors the SUPERADMIN_EMAILS default in lib/auth.ts so the two stay in
// sync. Superadmins always count as settings admins.
const SUPERADMIN_EMAILS = parseEmails(
  process.env.SUPERADMIN_EMAILS || 'rc@successifier.com,mc@successifier.com',
);

// Optional per-deployment extension without a code change.
const EXTRA_SETTINGS_ADMINS = parseEmails(process.env.SETTINGS_ADMIN_EMAILS);

/** Every email allowed into Settings on this deployment, lowercased. */
export function settingsAdminEmails(): string[] {
  return Array.from(
    new Set([
      ...SUPERADMIN_EMAILS,
      ...EXTRA_SETTINGS_ADMINS,
      ...product.adminEmails.map((e) => e.toLowerCase()),
    ]),
  );
}

/**
 * Whether the given identity may access Settings/admin on this deployment.
 * Granted to superadmins, users with the 'admin' role (assignable from the
 * user-admin UI), and the product's admin email allowlist (e.g. Ida).
 */
export function isSettingsAdmin(email?: string | null, role?: string | null): boolean {
  if (role === 'superadmin' || role === 'admin') return true;
  const e = (email || '').toLowerCase();
  if (!e) return false;
  return settingsAdminEmails().includes(e);
}

/**
 * Whether the given identity is a global superadmin (us, the platform
 * operators) — by role or the SUPERADMIN_EMAILS allowlist. Note this does NOT
 * include the product's admin allowlist (e.g. Ida); those are regular settings
 * admins. Used to hide superadmins from the user-admin UI.
 */
export function isSuperadmin(email?: string | null, role?: string | null): boolean {
  if (role === 'superadmin') return true;
  const e = (email || '').toLowerCase();
  if (!e) return false;
  return SUPERADMIN_EMAILS.includes(e);
}
