import { google } from 'googleapis';
import { getMessageAttachments } from '@/lib/integrations/gmail-attachments';

export class GmailService {
  private gmail;
  private oauth2Client;

  constructor(credentials: { clientId: string; clientSecret: string; refreshToken: string }) {
    this.oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      'https://developers.google.com/oauthplayground'
    );

    this.oauth2Client.setCredentials({
      refresh_token: credentials.refreshToken,
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  async getUnreadEmails(maxResults: number = 10) {
    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread',
        maxResults,
      });

      const messages = response.data.messages || [];
      const emails = [];

      for (const message of messages) {
        const email = await this.getEmailDetails(message.id!);
        if (email) {
          emails.push(email);
        }
      }

      return emails;
    } catch (error) {
      console.error('Error fetching unread emails:', error);
      return [];
    }
  }

  async getEmailDetails(messageId: string) {
    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const message = response.data;
      const headers = message.payload?.headers || [];

      const getHeader = (name: string) => {
        const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
        return header?.value || '';
      };

      const from = getHeader('From');
      const subject = getHeader('Subject');
      const date = getHeader('Date');

      // Extract email address from "Name <email@example.com>" format
      const emailMatch = from.match(/<(.+?)>/);
      const email = emailMatch ? emailMatch[1] : from;

      // Extract name
      const nameMatch = from.match(/^(.+?)\s*</);
      const name = nameMatch ? nameMatch[1].replace(/"/g, '') : email;

      // Get email body
      let body = '';
      if (message.payload?.parts) {
        const textPart = message.payload.parts.find(
          (part) => part.mimeType === 'text/plain'
        );
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
      } else if (message.payload?.body?.data) {
        body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
      }

      // Pull any attachments (images, PDFs, docs) so the inbox-check path
      // surfaces them in-app rather than forcing support into Gmail.
      const attachments = await getMessageAttachments(this.gmail, messageId, message.payload || undefined);

      return {
        id: messageId,
        from: email,
        name,
        subject,
        body,
        date,
        threadId: message.threadId,
        attachments,
      };
    } catch (error) {
      console.error(`Error fetching email ${messageId}:`, error);
      return null;
    }
  }

  async markAsRead(messageId: string) {
    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });
      return true;
    } catch (error) {
      console.error(`Error marking email ${messageId} as read:`, error);
      return false;
    }
  }

  async getEmailThread(threadId: string) {
    try {
      const response = await this.gmail.users.threads.get({
        userId: 'me',
        id: threadId,
      });

      const messages = response.data.messages || [];
      return messages.map((msg) => ({
        id: msg.id,
        snippet: msg.snippet,
        internalDate: msg.internalDate,
      }));
    } catch (error) {
      console.error(`Error fetching thread ${threadId}:`, error);
      return [];
    }
  }

  async sendEmail(to: string, subject: string, body: string) {
    try {
      const rawMessage = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        '',
        body,
      ].join('\r\n');

      const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });

      return { success: true, messageId: res.data.id };
    } catch (error) {
      console.error('Error sending email via Gmail:', error);
      throw error;
    }
  }

  async getCustomerContext(customerEmail: string) {
    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: `from:${customerEmail} OR to:${customerEmail}`,
        maxResults: 20,
      });

      const messages = response.data.messages || [];
      
      return {
        totalEmails: messages.length,
        recentEmails: messages.slice(0, 5).map((msg) => ({
          id: msg.id,
          threadId: msg.threadId,
        })),
      };
    } catch (error) {
      console.error('Error getting customer context from Gmail:', error);
      return null;
    }
  }
}
