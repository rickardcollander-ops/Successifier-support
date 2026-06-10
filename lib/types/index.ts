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
  clerk?: {
    userId?: string;
    name?: string | null;
    username?: string | null;
    primaryEmail?: string | null;
    emailVerified?: boolean;
    emails?: Array<{ email: string; verified: boolean; primary: boolean }>;
    phone?: string | null;
    phoneVerified?: boolean;
    createdAt?: number | null;
    lastSignInAt?: number | null;
    lastActiveAt?: number | null;
    passwordEnabled?: boolean;
    twoFactorEnabled?: boolean;
    socialAccounts?: string[];
    banned?: boolean;
    locked?: boolean;
    lockoutExpiresInSeconds?: number | null;
    plan?: string | null;
    metadata?: Record<string, unknown> | null;
    organizations?: Array<{ name: string; role: string }>;
  };
  attachments?: Array<{
    filename: string;
    mimeType: string;
    // Byte size of the attachment. Present for newly synced mail; older
    // tickets may omit it.
    size?: number;
    // Full data URL with the bytes. Stripped from the ticket-list endpoint
    // to keep the 3s poll light — the detail view lazy-loads it from the
    // single-ticket endpoint. May therefore be absent in list payloads.
    dataUrl?: string;
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
  // Public help-center fields
  slug: string | null;
  isPublic: boolean;
  status: string; // 'draft' | 'review' | 'published'
  excerpt: string | null;
  relatedIds: string[];
  sortOrder: number;
  viewCount: number;
  categoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeCategory {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeRevision {
  id: string;
  articleId: string;
  title: string;
  content: string;
  excerpt: string | null;
  editedBy: string | null;
  createdAt: Date;
}

// Shape returned by the public help-center API. Deliberately a narrow subset
// of KnowledgeBase — never exposes tenantId, isActive, internal flags or PII.
export interface PublicArticle {
  slug: string;
  title: string;
  excerpt: string | null;
  content?: string;
  category: { slug: string; name: string } | null;
  tags: string[];
  updatedAt: Date;
}

export interface Integration {
  id: string;
  tenantId: string;
  type: 'stripe' | 'billecta' | 'retool' | 'resend' | 'gmail' | 'clerk';
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
