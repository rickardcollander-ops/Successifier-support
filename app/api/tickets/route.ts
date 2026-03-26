import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { generateAIResponse } from '@/lib/services/ai-generator';

const ZENDESK_IMPORT_MARKER = '[Zendesk Import Source:';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    // Find tenant by subdomain
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: 'doldadress' },
    });

    if (!tenant) {
      return NextResponse.json({ tickets: [] });
    }

    // If requesting archived tickets
    if (status === 'archived') {
      const tickets = await prisma.ticket.findMany({
        where: {
          tenantId: tenant.id,
          status: 'archived',
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return NextResponse.json({ tickets });
    }

    // Default: exclude archived and Zendesk imports
    const tickets = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        status: { not: 'archived' },
        NOT: {
          originalMessage: {
            contains: ZENDESK_IMPORT_MARKER,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tickets' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customerEmail, customerName, subject, originalMessage, priority } = body;

    if (!customerEmail || !subject || !originalMessage) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Find tenant by subdomain
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: 'doldadress' },
    });

    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      );
    }

    const ticket = await prisma.ticket.create({
      data: {
        tenantId: tenant.id,
        customerEmail,
        customerName,
        subject,
        originalMessage,
        priority: priority || 'normal',
        status: 'new',
      },
    });

    // Generate AI response immediately in background
    generateAIResponse(subject, originalMessage, null, tenant.id)
      .then(async ({ response, confidence }) => {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            aiResponse: response,
            aiConfidence: confidence,
          },
        });
        console.log(`AI response generated for ticket ${ticket.id} with ${Math.round(confidence * 100)}% confidence`);
      })
      .catch((error) => {
        console.error(`Failed to generate AI response for ticket ${ticket.id}:`, error);
      });

    return NextResponse.json(ticket);
  } catch (error) {
    console.error('Error creating ticket:', error);
    return NextResponse.json(
      { error: 'Failed to create ticket' },
      { status: 500 }
    );
  }
}
