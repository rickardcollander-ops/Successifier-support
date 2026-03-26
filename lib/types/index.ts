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
  status: 'new' | 'in_progress' | 'waiting_ai' | 'review' | 'sent' | 'closed' | 'archived';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  originalMessage: string;
  aiResponse?: string;
  aiConfidence?: number;
  finalResponse?: string;
  contextData?: TicketContext;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketContext {
  [key: string]: any;
  stripe?: {
    customerId?: string;
    subscriptions?: any[];
    invoices?: any[];
    charges?: any[];
  };
  billecta?: {
    debtorId?: string;
    debtorPublicId?: string;
    debtorName?: string;
    debtorOrgNo?: string;
    creditorPublicId?: string;
    invoices?: any[];
  };
  retool?: any;
  resend?: {
    emailsSent?: number;
    recentEmails?: any[];
  };
  gmail?: {
    totalEmails?: number;
    recentEmails?: any[];
  };
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
