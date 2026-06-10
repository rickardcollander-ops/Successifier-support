import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { product } from '@/lib/products';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { requireSuperadmin } from '@/lib/api-auth';

const testTickets = [
  {
    customerEmail: 'anna.svensson@gmail.com',
    customerName: 'Anna Svensson',
    subject: 'Vill säga upp mitt larmabonnemang',
    originalMessage: 'Hej! Jag ska flytta utomlands och behöver säga upp mitt larmabonnemang. Hur lång är uppsägningstiden och vad händer med larmutrustningen?',
    status: 'new',
    priority: 'normal',
    contextData: {
      stripe: { customerId: 'cus_anna1', subscriptions: [{ id: 'sub_1', status: 'active', plan: 'Hemlarm Plus' }], invoices: [{ id: 'inv_1', amount: 299, status: 'paid' }], charges: [{ id: 'ch_1', amount: 299 }] },
      billecta: { debtorId: 'deb_anna', invoices: [{ id: 'bill_1', amount: 299 }] },
    },
  },
  {
    customerEmail: 'erik.johansson@hotmail.com',
    customerName: 'Erik Johansson',
    subject: 'Fakturan stämmer inte',
    originalMessage: 'Hej, jag har fått en faktura på 399 kr men jag har ju Hemlarm Bas som kostar 199 kr/mån. Varför har priset höjts utan förvarning?',
    status: 'new',
    priority: 'high',
    contextData: {
      stripe: { customerId: 'cus_erik2', subscriptions: [{ id: 'sub_2', status: 'active', plan: 'Hemlarm Bas' }], invoices: [{ id: 'inv_2', amount: 399, status: 'open' }, { id: 'inv_3', amount: 199, status: 'paid' }], charges: [{ id: 'ch_2', amount: 199 }, { id: 'ch_3', amount: 199 }] },
    },
  },
  {
    customerEmail: 'maria.lindberg@yahoo.se',
    customerName: 'Maria Lindberg',
    subject: 'Larmet går inte att koppla till',
    originalMessage: 'Mitt hemlarm har tappat uppkopplingen sedan i morse. Röda lampan blinkar. Jag har provat starta om men det hjälper inte. Är jag fortfarande skyddad?',
    status: 'in_progress',
    priority: 'urgent',
    contextData: {
      stripe: { customerId: 'cus_maria3', subscriptions: [{ id: 'sub_3', status: 'active', plan: 'Hemlarm Premium' }], invoices: [{ id: 'inv_4', amount: 499 }], charges: [{ id: 'ch_4', amount: 499 }] },
      retool: { customData: 'Senaste larmhändelse: 2026-02-05 08:32', deviceStatus: 'offline' },
    },
  },
  {
    customerEmail: 'johan.berg@gmail.com',
    customerName: 'Johan Berg',
    subject: 'Uppgradera till kameraövervakning',
    originalMessage: 'Hej! Jag har Hemlarm Bas idag men vill lägga till kameraövervakning. Vad kostar det och ingår installation?',
    status: 'new',
    priority: 'normal',
    contextData: {
      stripe: { customerId: 'cus_johan4', subscriptions: [{ id: 'sub_4', status: 'active', plan: 'Hemlarm Bas' }], invoices: [{ id: 'inv_5', amount: 199 }], charges: [{ id: 'ch_5', amount: 199 }] },
    },
  },
  {
    customerEmail: 'lisa.ek@outlook.com',
    customerName: 'Lisa Ek',
    subject: 'Pausera abonnemang under sommaren',
    originalMessage: 'Vi åker bort i 3 månader i sommar. Kan jag pausa mitt abonnemang under tiden eller måste jag betala ändå?',
    status: 'new',
    priority: 'low',
    contextData: {
      stripe: { customerId: 'cus_lisa5', subscriptions: [{ id: 'sub_5', status: 'active', plan: 'Hemlarm Plus' }], invoices: [{ id: 'inv_6', amount: 299 }], charges: [{ id: 'ch_6', amount: 299 }] },
      resend: { emailsSent: 3, recentEmails: [{ id: 'e1', subject: 'Välkommen som kund' }] },
    },
  },
  {
    customerEmail: 'peter.nord@live.se',
    customerName: 'Peter Nord',
    subject: 'Ändra betalningsmetod',
    originalMessage: 'Jag vill byta från autogiro till kortbetalning. Hur gör jag det? Mitt nuvarande kort går ut snart.',
    status: 'new',
    priority: 'normal',
    contextData: {
      stripe: { customerId: 'cus_peter6', subscriptions: [{ id: 'sub_6', status: 'active', plan: 'Hemlarm Premium' }], invoices: [{ id: 'inv_7', amount: 499 }, { id: 'inv_8', amount: 499 }], charges: [{ id: 'ch_7', amount: 499 }] },
      billecta: { debtorId: 'deb_peter', invoices: [{ id: 'bill_2', amount: 499 }] },
    },
  },
  {
    customerEmail: 'sara.holm@icloud.com',
    customerName: 'Sara Holm',
    subject: 'Lägga till fler användare i appen',
    originalMessage: 'Min man och jag vill båda kunna styra larmet via appen. Hur lägger jag till honom som användare?',
    status: 'review',
    priority: 'normal',
    contextData: {
      stripe: { customerId: 'cus_sara7', subscriptions: [{ id: 'sub_7', status: 'active', plan: 'Hemlarm Plus' }], invoices: [{ id: 'inv_9', amount: 299 }], charges: [{ id: 'ch_8', amount: 299 }] },
    },
  },
  {
    customerEmail: 'anders.lund@gmail.com',
    customerName: 'Anders Lund',
    subject: 'Rabatt för pensionärer?',
    originalMessage: 'Hej, jag är pensionär och undrar om ni har någon rabatt för oss äldre? Jag har hört att andra säkerhetsbolag erbjuder det.',
    status: 'new',
    priority: 'normal',
    contextData: {
      stripe: { customerId: 'cus_anders8', subscriptions: [{ id: 'sub_8', status: 'active', plan: 'Hemlarm Bas' }], invoices: [{ id: 'inv_10', amount: 199 }], charges: [{ id: 'ch_9', amount: 199 }] },
      resend: { emailsSent: 2, recentEmails: [{ id: 'e2', subject: 'Din faktura' }] },
    },
  },
  {
    customerEmail: 'karin.palm@hotmail.com',
    customerName: 'Karin Palm',
    subject: 'Betalning misslyckades',
    originalMessage: 'Jag fick SMS om att betalningen inte gick igenom. Jag har satt in pengar på kontot nu. Kan ni dra igen så jag inte blir avstängd?',
    status: 'new',
    priority: 'high',
    contextData: {
      stripe: { customerId: 'cus_karin9', subscriptions: [{ id: 'sub_9', status: 'past_due', plan: 'Hemlarm Plus' }], invoices: [{ id: 'inv_11', amount: 299, status: 'failed' }], charges: [{ id: 'ch_10', amount: 299, status: 'failed' }] },
      billecta: { debtorId: 'deb_karin', invoices: [{ id: 'bill_3', amount: 299, status: 'overdue' }] },
    },
  },
  {
    customerEmail: 'magnus.gren@telia.com',
    customerName: 'Magnus Gren',
    subject: 'Flytta larmet till ny adress',
    originalMessage: 'Jag ska flytta om 2 veckor. Kan jag ta med mig larmutrustningen till nya lägenheten eller behöver jag ny installation?',
    status: 'new',
    priority: 'normal',
    contextData: {
      stripe: { customerId: 'cus_magnus10', subscriptions: [{ id: 'sub_10', status: 'active', plan: 'Hemlarm Premium' }], invoices: [{ id: 'inv_12', amount: 499 }], charges: [{ id: 'ch_11', amount: 499 }] },
      resend: { emailsSent: 5, recentEmails: [{ id: 'e3', subject: 'Bekräftelse installation' }, { id: 'e4', subject: 'Din faktura' }] },
    },
  },
];

export async function POST() {
  const authResult = await requireSuperadmin();
  if (!authResult.ok) return authResult.response;

  try {
    // First, ensure the tenant exists
    const tenant = await prisma.tenant.upsert({
      where: { subdomain: product.key },
      update: {},
      create: {
        subdomain: product.key,
        name: `${product.displayName} Support`,
      },
    });

    // Create 10 test tickets with varied data
    const tickets = await Promise.all(
      testTickets.map((ticketData) =>
        prisma.ticket.create({
          data: {
            tenantId: tenant.id,
            ...ticketData,
          },
        })
      )
    );

    // Generate AI responses for all tickets in background
    tickets.forEach((ticket) => {
      generateAIResponse(ticket.subject, ticket.originalMessage, ticket.contextData)
        .then(async ({ response, confidence }) => {
          await prisma.ticket.update({
            where: { id: ticket.id },
            data: {
              aiResponse: response,
              aiConfidence: confidence,
            },
          });
          console.log(`AI response generated for ticket ${ticket.id} (${ticket.subject}) with ${Math.round(confidence * 100)}% confidence`);
        })
        .catch((error) => {
          console.error(`Failed to generate AI response for ticket ${ticket.id}:`, error);
        });
    });

    return NextResponse.json({
      success: true,
      message: `Created ${tickets.length} test tickets. AI responses are being generated...`,
      tickets,
    });
  } catch (error) {
    console.error('Error creating test tickets:', error);
    return NextResponse.json(
      { error: 'Failed to create test tickets' },
      { status: 500 }
    );
  }
}
