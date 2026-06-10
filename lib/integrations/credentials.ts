import { decryptJSON, isEncrypted } from '@/lib/crypto';

const MASK = '••••••••';

export function decryptCredentials(raw: unknown): Record<string, string> {
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (isEncrypted(str)) {
    return decryptJSON(str);
  }
  return (raw && typeof raw === 'object' ? raw : {}) as Record<string, string>;
}

// Secrets never leave the server. The UI only needs to know WHICH fields are
// configured, so every value is replaced by a mask.
export function maskCredentials(credentials: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(credentials).map((key) => [key, MASK]));
}

// Drop masked/empty values from a submitted credentials object so an edit
// that leaves a field untouched keeps the stored secret.
export function mergeCredentials(
  existing: Record<string, string>,
  submitted: Record<string, string>
): Record<string, string> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(submitted)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || /^[•*]+$/.test(trimmed)) continue;
    merged[key] = trimmed;
  }
  return merged;
}
