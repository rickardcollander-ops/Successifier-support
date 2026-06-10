import crypto from 'crypto';
import { product } from '@/lib/products';

// Pure key helpers, kept free of prisma/next-auth imports so they can be
// unit-tested. API keys are stored as SHA-256 hashes (ApiKey.key); the
// plaintext is only shown once, in the response that creates it.

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function maskApiKey(key: string): string {
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export function generateApiKey(): string {
  const prefix = product.apiKeyPrefix;
  const randomPart = crypto.randomBytes(24).toString('base64url');
  return `${prefix}_${randomPart}`;
}
