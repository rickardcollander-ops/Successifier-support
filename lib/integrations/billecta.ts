export class BillectaService {
  private secureToken: string;
  private creditorPublicId: string;
  private baseUrl = 'https://api.billecta.com';

  constructor(apiKey: string, creditorPublicId: string) {
    this.secureToken = apiKey;
    this.creditorPublicId = creditorPublicId;
  }

  /**
   * Per Billecta docs: SecureToken must be base64-encoded in the Authorization header.
   * The token from the portal may already be base64 or raw — we try both.
   */
  private getAuthHeaders(): Array<Record<string, string>> {
    const raw = this.secureToken.trim();
    const encoded = Buffer.from(raw, 'utf8').toString('base64');

    // If the stored key is already base64, use it directly AND try re-encoding
    // If the stored key is raw, encode it
    const variants = new Set<string>();
    variants.add(encoded);   // base64(raw) — correct if raw token stored
    variants.add(raw);       // raw as-is — correct if already base64-encoded

    return [...variants].map((token) => ({
      'Authorization': `SecureToken ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    }));
  }

  private async request(endpoint: string) {
    const headerVariants = this.getAuthHeaders();
    let lastStatus = 0;
    let lastBody = '';

    for (const headers of headerVariants) {
      const response = await fetch(`${this.baseUrl}${endpoint}`, { headers });

      lastStatus = response.status;

      if (response.ok) {
        return response.json();
      }

      lastBody = (await response.text().catch(() => '')).slice(0, 200);
    }

    throw new Error(`Billecta API ${lastStatus}: ${lastBody}`);
  }

  /**
   * Billecta has no search-by-email endpoint.
   * GET /v1/debtors/debtors/{creditorPublicId} returns all debtors.
   * We filter client-side by Email or ContactEmail.
   */
  async getDebtorByEmail(email: string) {
    try {
      const debtors = await this.request(
        `/v1/debtors/debtors/${this.creditorPublicId}`
      );

      const normalizedEmail = email.toLowerCase().trim();
      const list = Array.isArray(debtors) ? debtors : [];

      return list.find((d: any) =>
        (d.Email || '').toLowerCase().trim() === normalizedEmail ||
        (d.ContactEmail || '').toLowerCase().trim() === normalizedEmail
      ) || null;
    } catch (error) {
      console.error('Error fetching Billecta debtors:', error);
      return null;
    }
  }

  async getCustomerContext(email: string) {
    try {
      const debtor = await this.getDebtorByEmail(email);
      if (!debtor) return null;

      // GET /v1/invoice/openbydebtor/{debtorPublicId} — open invoices for debtor
      let openInvoices: any[] = [];
      try {
        const open = await this.request(
          `/v1/invoice/openbydebtor/${debtor.DebtorPublicId}`
        );
        openInvoices = Array.isArray(open) ? open : [];
      } catch {
        openInvoices = [];
      }

      // GET /v1/invoice/closedbydebtor/{debtorPublicId}?from=...&to=...
      let closedInvoices: any[] = [];
      try {
        const now = new Date();
        const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        const from = yearAgo.toISOString().split('T')[0];
        const to = now.toISOString().split('T')[0];
        const closed = await this.request(
          `/v1/invoice/closedbydebtor/${debtor.DebtorPublicId}?from=${from}&to=${to}`
        );
        closedInvoices = Array.isArray(closed) ? closed : [];
      } catch {
        closedInvoices = [];
      }

      const allInvoices = [...openInvoices, ...closedInvoices];

      return {
        creditorPublicId: this.creditorPublicId,
        debtorPublicId: debtor.DebtorPublicId,
        debtorName: debtor.Name || null,
        debtorOrgNo: debtor.OrgNo || null,
        debtorStatus: debtor.Status || null,
        debtorClosedDate: debtor.ClosedDate || null,
        invoices: allInvoices.map((inv: any) => ({
          id: inv.ActionPublicId,
          number: inv.InvoiceNumber,
          status: inv.Stage,
          amount: inv.CurrentAmount?.ValueForView ?? inv.InvoicedAmount?.ValueForView ?? null,
          dueDate: inv.DueDate,
          closedDate: inv.ClosedDate || inv.AttestDate || null,
          isPaid: inv.Stage === 'Completed',
          deliveryMethod: inv.DeliveryMethod || null,
        })),
      };
    } catch (error) {
      console.error('Error fetching Billecta context:', error);
      return null;
    }
  }
}
