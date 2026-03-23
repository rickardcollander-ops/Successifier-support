import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { decryptJSON, isEncrypted } from '@/lib/crypto';

async function stripeProbe(apiKey: string) {
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (res.ok) {
      return {
        ok: true,
        message: 'Stripe connection successful',
      };
    }

    return {
      ok: false,
      message: `Stripe auth failed: HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: 'Stripe connection error',
    };
  }
}

async function resendProbe(apiKey: string, fromEmail: string) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: 'test@resend.dev',
        subject: 'Test',
        html: '<p>Test</p>',
      }),
    });

    const data = await res.json();

    if (res.ok || res.status === 422) {
      return {
        ok: true,
        message: 'Resend API key valid',
      };
    }

    return {
      ok: false,
      message: `Resend auth failed: ${data.message || res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: 'Resend connection error',
    };
  }
}

async function retoolProbe(apiKey: string, workspaceUrl: string) {
  try {
    const url = workspaceUrl.replace(/\/$/, '');
    const res = await fetch(`${url}/api/resources`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (res.ok) {
      return {
        ok: true,
        message: 'Retool connection successful',
      };
    }

    return {
      ok: false,
      message: `Retool auth failed: HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: 'Retool connection error',
    };
  }
}

async function gmailProbe(clientId: string, clientSecret: string, refreshToken: string) {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (res.ok) {
      return {
        ok: true,
        message: 'Gmail OAuth credentials valid',
      };
    }

    return {
      ok: false,
      message: `Gmail auth failed: HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: 'Gmail connection error',
    };
  }
}

async function postmanProbe(apiKey: string, workspaceId: string) {
  try {
    const res = await fetch(`https://api.getpostman.com/workspaces/${workspaceId}`, {
      headers: {
        'X-Api-Key': apiKey,
      },
    });

    if (res.ok) {
      return {
        ok: true,
        message: 'Postman connection successful',
      };
    }

    return {
      ok: false,
      message: `Postman auth failed: HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: 'Postman connection error',
    };
  }
}

/**
 * Per Billecta docs (https://docs.billecta.com/api):
 * - Auth: SecureToken must be base64-encoded in the Authorization header
 * - Endpoint to verify credentials: GET /v1/creditors/creditors (returns all creditors for user)
 */
async function billectaProbe(creditorPublicId: string, apiKey: string) {
  const baseUrl = 'https://api.billecta.com';
  const endpoint = `${baseUrl}/v1/creditors/creditors`;

  const raw = apiKey.trim();
  const encoded = Buffer.from(raw, 'utf8').toString('base64');

  // Try both: base64(raw) and raw-as-is (in case it's already encoded)
  const tokenVariants = [...new Set([encoded, raw])];

  let lastStatus = 401;
  let lastBodySnippet = '';

  for (const token of tokenVariants) {
    const res = await fetch(endpoint, {
      headers: {
        'Authorization': `SecureToken ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    lastStatus = res.status;

    if (res.ok) {
      const body = await res.json();
      const creditors = Array.isArray(body) ? body : [];
      const matched = creditors.find(
        (c: any) => c.CreditorPublicId === creditorPublicId
      );

      return {
        ok: true,
        upstreamStatus: res.status,
        authScheme: 'SecureToken',
        usedEncodedKey: token === encoded,
        matchedCreditorPublicId: matched?.CreditorPublicId || null,
        creditorName: matched?.Name || null,
        totalCreditors: creditors.length,
        message: matched
          ? `Billecta OK — creditor "${matched.Name}" found`
          : `Billecta auth OK but creditorPublicId not found among ${creditors.length} creditors`,
      };
    }

    lastBodySnippet = (await res.text().catch(() => '')).slice(0, 200);
  }

  return {
    ok: false,
    upstreamStatus: lastStatus,
    authScheme: 'SecureToken',
    ...(process.env.NODE_ENV !== 'production' && lastBodySnippet
      ? { upstreamBodySnippet: lastBodySnippet }
      : {}),
    message: `Billecta auth failed: HTTP ${lastStatus}`,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === 'string' && body.email.trim().length > 0
      ? body.email.trim()
      : 'test@example.com';

    const integration = await prisma.integration.findUnique({
      where: { id },
      select: { id: true, type: true, credentials: true, isActive: true },
    });

    if (!integration) {
      return NextResponse.json({ ok: false, message: 'Integration not found' }, { status: 404 });
    }

    // Decrypt credentials if they are encrypted
    const rawCredentials = integration.credentials;
    const credentialsStr = typeof rawCredentials === 'string'
      ? rawCredentials
      : JSON.stringify(rawCredentials);

    const credentials: any = isEncrypted(credentialsStr)
      ? decryptJSON(credentialsStr)
      : rawCredentials;
    
    let result;

    switch (integration.type) {
      case 'stripe': {
        const apiKey = credentials?.apiKey ? String(credentials.apiKey).trim() : '';
        if (!apiKey) {
          return NextResponse.json({
            ok: false,
            message: 'Missing Stripe API key'
          }, { status: 400 });
        }
        result = await stripeProbe(apiKey);
        break;
      }

      case 'billecta': {
        const apiKey = String(credentials.apiKey || '').trim();
        const creditorPublicId = String(credentials.creditorPublicId || '').trim();
        if (!apiKey || !creditorPublicId) {
          return NextResponse.json({ ok: false, message: 'Missing Billecta credentials' }, { status: 400 });
        }
        result = await billectaProbe(creditorPublicId, apiKey);
        break;
      }

      case 'resend': {
        const apiKey = String(credentials.apiKey || '').trim();
        const fromEmail = String(credentials.fromEmail || '').trim();
        if (!apiKey || !fromEmail) {
          return NextResponse.json({ ok: false, message: 'Missing Resend credentials' }, { status: 400 });
        }
        result = await resendProbe(apiKey, fromEmail);
        break;
      }

      case 'retool': {
        const apiKey = String(credentials.apiKey || '').trim();
        const workspaceUrl = String(credentials.workspaceUrl || '').trim();
        if (!apiKey || !workspaceUrl) {
          return NextResponse.json({ ok: false, message: 'Missing Retool credentials' }, { status: 400 });
        }
        result = await retoolProbe(apiKey, workspaceUrl);
        break;
      }

      case 'gmail': {
        const clientId = String(credentials.clientId || '').trim();
        const clientSecret = String(credentials.clientSecret || '').trim();
        const refreshToken = String(credentials.refreshToken || '').trim();
        if (!clientId || !clientSecret || !refreshToken) {
          return NextResponse.json({ ok: false, message: 'Missing Gmail OAuth credentials' }, { status: 400 });
        }
        result = await gmailProbe(clientId, clientSecret, refreshToken);
        break;
      }

      case 'postman': {
        const apiKey = String(credentials.apiKey || '').trim();
        const workspaceId = String(credentials.workspaceId || '').trim();
        if (!apiKey || !workspaceId) {
          return NextResponse.json({ ok: false, message: 'Missing Postman credentials' }, { status: 400 });
        }
        result = await postmanProbe(apiKey, workspaceId);
        break;
      }

      default:
        return NextResponse.json({ ok: false, message: `Testing not supported for ${integration.type}` }, { status: 400 });
    }

    return NextResponse.json({
      integrationId: integration.id,
      integrationType: integration.type,
      isActive: integration.isActive,
      testedEmail: email,
      ...result,
    });
  } catch (error) {
    console.error('Error testing integration connection:', error);
    const details = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        ok: false,
        message: 'Failed to test integration connection',
        ...(process.env.NODE_ENV !== 'production' ? { details } : {}),
      },
      { status: 500 }
    );
  }
}
