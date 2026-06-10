import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';

const BILLECTA_BASE_URL = 'https://api.billecta.com';

function getAuthHeaders(secureToken: string): Array<Record<string, string>> {
  const raw = secureToken.trim();
  const encoded = Buffer.from(raw, 'utf8').toString('base64');
  const variants = new Set([encoded, raw]);
  return [...variants].map((token) => ({
    Authorization: `SecureToken ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }));
}

async function billectaRequest(endpoint: string, secureToken: string) {
  const headerVariants = getAuthHeaders(secureToken);
  let lastStatus = 0;
  let lastBody = '';

  for (const headers of headerVariants) {
    const response = await fetch(`${BILLECTA_BASE_URL}${endpoint}`, { headers });
    lastStatus = response.status;
    if (response.ok) return response.json();
    lastBody = (await response.text().catch(() => '')).slice(0, 300);
  }

  throw new Error(`Billecta API ${lastStatus}: ${lastBody}`);
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await request.json();
    const { query, searchType } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json({ error: 'Search query is required' }, { status: 400 });
    }

    const tenant = await getTenant();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const integration = await prisma.integration.findFirst({
      where: { tenantId: tenant.id, type: 'billecta', isActive: true },
      select: { credentials: true },
    });

    if (!integration?.credentials) {
      return NextResponse.json({ error: 'No active Billecta integration' }, { status: 404 });
    }

    const creds = integration.credentials as Record<string, string>;
    const apiKey = creds.apiKey;
    const creditorPublicId = creds.creditorPublicId;

    if (!apiKey || !creditorPublicId) {
      return NextResponse.json({ error: 'Billecta credentials incomplete' }, { status: 400 });
    }

    const trimmedQuery = query.trim();

    // Search by invoice number
    if (searchType === 'invoice' || /^\d+$/.test(trimmedQuery)) {
      try {
        const invoice = await billectaRequest(
          `/v1/invoice/actionbyinvoicenumber/${creditorPublicId}?invoiceNumber=${encodeURIComponent(trimmedQuery)}`,
          apiKey
        );

        if (invoice) {
          return NextResponse.json({
            type: 'invoice',
            results: [
              {
                actionPublicId: invoice.ActionPublicId,
                invoiceNumber: invoice.InvoiceNumber,
                stage: invoice.Stage,
                debtorName: invoice.DebtorName,
                debtorPublicId: invoice.DebtorPublicId,
                invoiceDate: invoice.InvoiceDate,
                dueDate: invoice.DueDate,
                currentAmount: invoice.CurrentAmount?.ValueForView ?? null,
                invoicedAmount: invoice.InvoicedAmount?.ValueForView ?? null,
                currency: invoice.CurrentAmount?.CurrencyCode || 'SEK',
                isPaid: invoice.Stage === 'Completed',
                deliveryMethod: invoice.DeliveryMethod,
              },
            ],
          });
        }
      } catch {
        // Fall through to debtor search
      }
    }

    // Search by person/org number
    if (searchType === 'orgno' || /^\d{6,12}[-]?\d{0,4}$/.test(trimmedQuery)) {
      try {
        const debtors = await billectaRequest(
          `/v1/debtors/debtorsbyorgno/${creditorPublicId}?orgNo=${encodeURIComponent(trimmedQuery)}&countryCode=SE`,
          apiKey
        );

        const list = Array.isArray(debtors) ? debtors : [];
        if (list.length > 0) {
          const results = await Promise.all(
            list.slice(0, 5).map(async (debtor: any) => {
              let openInvoices: any[] = [];
              try {
                const inv = await billectaRequest(
                  `/v1/invoice/openbydebtor/${debtor.DebtorPublicId}`,
                  apiKey
                );
                openInvoices = Array.isArray(inv) ? inv : [];
              } catch { /* ignore */ }

              return {
                debtorPublicId: debtor.DebtorPublicId,
                name: debtor.Name,
                orgNo: debtor.OrgNo,
                email: debtor.Email || debtor.ContactEmail || null,
                address: debtor.Address || null,
                city: debtor.City || null,
                zipCode: debtor.ZipCode || null,
                openInvoices: openInvoices.map((inv: any) => ({
                  actionPublicId: inv.ActionPublicId,
                  invoiceNumber: inv.InvoiceNumber,
                  stage: inv.Stage,
                  dueDate: inv.DueDate,
                  currentAmount: inv.CurrentAmount?.ValueForView ?? null,
                  isPaid: inv.Stage === 'Completed',
                  deliveryMethod: inv.DeliveryMethod || null,
                })),
              };
            })
          );

          return NextResponse.json({ type: 'debtor', results });
        }
      } catch {
        // Fall through to general debtor search
      }
    }

    // General search: fetch all debtors and filter by name/email/number
    try {
      const allDebtors = await billectaRequest(
        `/v1/debtors/debtors/${creditorPublicId}`,
        apiKey
      );

      const list = Array.isArray(allDebtors) ? allDebtors : [];
      const queryLower = trimmedQuery.toLowerCase();

      const matched = list
        .filter((d: any) => {
          const name = (d.Name || '').toLowerCase();
          const email = (d.Email || '').toLowerCase();
          const contactEmail = (d.ContactEmail || '').toLowerCase();
          const orgNo = (d.OrgNo || '').replace('-', '');
          const debtorNumber = String(d.DebtorNumber || '');
          const queryClean = queryLower.replace('-', '');

          return (
            name.includes(queryLower) ||
            email.includes(queryLower) ||
            contactEmail.includes(queryLower) ||
            orgNo.includes(queryClean) ||
            debtorNumber === trimmedQuery
          );
        })
        .slice(0, 10);

      if (matched.length > 0) {
        const results = await Promise.all(
          matched.map(async (debtor: any) => {
            let openInvoices: any[] = [];
            try {
              const inv = await billectaRequest(
                `/v1/invoice/openbydebtor/${debtor.DebtorPublicId}`,
                apiKey
              );
              openInvoices = Array.isArray(inv) ? inv : [];
            } catch { /* ignore */ }

            return {
              debtorPublicId: debtor.DebtorPublicId,
              name: debtor.Name,
              orgNo: debtor.OrgNo,
              email: debtor.Email || debtor.ContactEmail || null,
              address: debtor.Address || null,
              city: debtor.City || null,
              zipCode: debtor.ZipCode || null,
              openInvoices: openInvoices.map((inv: any) => ({
                actionPublicId: inv.ActionPublicId,
                invoiceNumber: inv.InvoiceNumber,
                stage: inv.Stage,
                dueDate: inv.DueDate,
                currentAmount: inv.CurrentAmount?.ValueForView ?? null,
                isPaid: inv.Stage === 'Completed',
                deliveryMethod: inv.DeliveryMethod || null,
              })),
            };
          })
        );

        return NextResponse.json({ type: 'debtor', results });
      }

      return NextResponse.json({ type: 'empty', results: [], message: 'Inga resultat hittades' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json({ error: `Billecta search failed: ${message}` }, { status: 500 });
    }
  } catch (error) {
    console.error('Billecta search error:', error);
    return NextResponse.json({ error: 'Failed to search Billecta' }, { status: 500 });
  }
}
