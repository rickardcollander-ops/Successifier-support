import { google } from 'googleapis';
import { prisma } from '@/lib/db/client';
import { encrypt, decryptIfEncrypted } from '@/lib/crypto';

// OAuth tokens in EmailAccount are encrypted at rest (AES-256-GCM via
// lib/crypto). Legacy rows that still hold plaintext tokens are read
// transparently and re-encrypted the next time Google rotates them.

export function gmailOAuthClient(
  account: { id: string; email?: string; accessToken: string; refreshToken: string },
  redirectUri?: string
) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  oauth2Client.setCredentials({
    access_token: decryptIfEncrypted(account.accessToken),
    refresh_token: decryptIfEncrypted(account.refreshToken),
  });

  // Persist refreshed tokens so future syncs don't fail
  oauth2Client.on('tokens', async (tokens) => {
    try {
      const updateData: { accessToken?: string; refreshToken?: string } = {};
      if (tokens.access_token) updateData.accessToken = encrypt(tokens.access_token);
      if (tokens.refresh_token) updateData.refreshToken = encrypt(tokens.refresh_token);
      if (Object.keys(updateData).length > 0) {
        await prisma.emailAccount.update({
          where: { id: account.id },
          data: updateData,
        });
      }
    } catch (err) {
      console.error(`[Gmail] Failed to persist refreshed tokens for ${account.email ?? account.id}:`, err);
    }
  });

  return oauth2Client;
}
