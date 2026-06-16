import { Resend } from 'resend';

export class ResendService {
  private resend: Resend;
  private fromEmail: string;

  constructor(apiKey: string, fromEmail: string) {
    this.resend = new Resend(apiKey);
    this.fromEmail = fromEmail;
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ filename: string; content: string }>,
  ) {
    try {
      const payload: any = {
        from: this.fromEmail,
        to,
        subject,
        html,
      };
      // Resend expects each attachment's `content` as a base64 string (or
      // Buffer) plus a filename. Only attach when we actually have files.
      if (attachments && attachments.length > 0) {
        payload.attachments = attachments;
      }
      const response = await this.resend.emails.send(payload);
      return response;
    } catch (error) {
      console.error('Error sending email via Resend:', error);
      throw error;
    }
  }

  /**
   * Fetch email history for a customer, limited to the last 7 days.
   * Resend's list API doesn't expose server-side date filtering, so we
   * request a generous page and filter client-side.
   */
  async getEmailHistory(email: string, lookbackDays = 7) {
    try {
      // Request a larger page so we have enough recent items after filtering
      const response = await (this.resend.emails.list as any)({ limit: 100 });
      if (!response.data) return [];

      // Resend v6 returns { data: { object: 'list', data: [...] } }
      const raw = response.data as any;
      const emailList = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];

      const normalizedEmail = email.toLowerCase().trim();
      const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

      const filtered = emailList.filter((e: any) => {
        // Date filter (last 7 days)
        const created = e.created_at ? new Date(e.created_at).getTime() : 0;
        if (created && created < cutoff) return false;

        // Email recipient filter
        const toAddresses = Array.isArray(e.to) ? e.to : [e.to].filter(Boolean);
        const fromStr = typeof e.from === 'string' ? e.from : '';
        return toAddresses.some((addr: string) => addr.toLowerCase().includes(normalizedEmail)) ||
               fromStr.toLowerCase().includes(normalizedEmail);
      });

      return filtered
        .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .map((e: any) => ({
          id: e.id,
          subject: e.subject,
          from: e.from,
          to: e.to,
          createdAt: e.created_at,
        }));
    } catch (error) {
      console.error('Error fetching Resend email history:', error);
      return [];
    }
  }

  async getCustomerContext(email: string) {
    try {
      // Last 7 days only — matches what the UI advertises
      const emailHistory = await this.getEmailHistory(email, 7);
      return {
        emailsSent: emailHistory.length,
        recentEmails: emailHistory,
        lookbackDays: 7,
      };
    } catch (error) {
      console.error('Error fetching Resend context:', error);
      return null;
    }
  }
}
