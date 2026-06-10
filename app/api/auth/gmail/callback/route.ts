import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { google } from 'googleapis';
import { prisma } from '@/lib/db/client';
import { encrypt } from '@/lib/crypto';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.email) {
      return NextResponse.redirect(new URL('/auth/signin', request.url));
    }

    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');

    if (!code) {
      return NextResponse.redirect(new URL('/settings/email-accounts?error=no_code', request.url));
    }

    // Force HTTPS and remove trailing slash to match Google Console exactly
    let callbackOrigin = process.env.GOOGLE_OAUTH_BASE_URL || request.nextUrl.origin;
    callbackOrigin = callbackOrigin.replace(/\/$/, ''); // Remove trailing slash
    
    // Ensure HTTPS in production
    if (!callbackOrigin.includes('localhost')) {
      callbackOrigin = callbackOrigin.replace(/^http:/, 'https:');
    }
    
    const callbackUrl = `${callbackOrigin}/api/auth/gmail/callback`;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user's Gmail address
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const emailAddress = profile.data.emailAddress!;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.redirect(new URL('/settings/email-accounts?error=user_not_found', request.url));
    }

    // Save email account
    await prisma.emailAccount.upsert({
      where: {
        userId_email: {
          userId: user.id,
          email: emailAddress,
        },
      },
      update: {
        accessToken: encrypt(tokens.access_token!),
        refreshToken: encrypt(tokens.refresh_token!),
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        isActive: true,
      },
      create: {
        userId: user.id,
        email: emailAddress,
        provider: 'google',
        accessToken: encrypt(tokens.access_token!),
        refreshToken: encrypt(tokens.refresh_token!),
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        isActive: true,
      },
    });

    return NextResponse.redirect(new URL('/settings/email-accounts?success=true', request.url));
  } catch (error) {
    console.error('Error in Gmail callback:', error);
    return NextResponse.redirect(new URL('/settings/email-accounts?error=callback_failed', request.url));
  }
}
