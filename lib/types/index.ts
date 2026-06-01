export interface Tenant {
  id: string;
  subdomain: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Ticket {
  id: string;
  tenantId: string;
  customerEmail: string;
  customerName?: string;
  subject: string;
  status: 'new' | 'in_progress' | 'waiting_ai' | 'review' | 'sent' | 'closed' | 'archived' | 'duplicate';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  originalMessage: string;
  aiResponse?: string;
  aiConfidence?: number;
  finalResponse?: string;
  contextData?: TicketContext;
  assignedTo?: string | null;
  sentBy?: string | null;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketContext {
  [key: string]: any;
  stripe?: {
    customerId?: string;
    accountClosed?: boolean;
    subscriptions?: any[];
    invoices?: any[];
    charges?: any[];
  };
  billecta?: {
    debtorId?: string;
    debtorPublicId?: string;
    debtorName?: string;
    debtorOrgNo?: string;
    debtorStatus?: string;
    debtorClosedDate?: string;
    creditorPublicId?: string;
    invoices?: any[];
  };
  retool?: {
    data?: any;
  };
  resend?: {
    emailsSent?: number;
    recentEmails?: any[];
  };
  gmail?: {
    totalEmails?: number;
    recentEmails?: any[];
  };
  attachments?: Array<{
    filename: string;
    mimeType: string;
    dataUrl: string;
  }>;
}

export interface KnowledgeBase {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Integration {
  id: string;
  tenantId: string;
  type: 'stripe' | 'billecta' | 'retool' | 'resend' | 'gmail';
  name: string;
  credentials: Record<string, string>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Agent {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
