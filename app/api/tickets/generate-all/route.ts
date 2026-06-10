import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { generateAIResponse } from '@/lib/services/ai-generator';
import { requireApiAuth, requireSession } from '@/lib/api-auth';

export async function POST() {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    // Find tenant
    const tenant = await getTenant();

    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      );
    }

    // Get all tickets without AI response
    const tickets = await prisma.ticket.findMany({
      where: {
        tenantId: tenant.id,
        aiResponse: null,
      },
    });

    const results = [];

    for (const ticket of tickets) {
      try {
        const { response: aiResponse, confidence } = await generateAIResponse(
          ticket.subject,
          ticket.originalMessage,
          ticket.contextData,
          tenant.id
        );

        // Raw SQL so we don't bump updatedAt — AI generation is not
        // customer activity and should not reorder the ticket list.
        await prisma.$executeRaw`
          UPDATE "Ticket"
          SET "aiResponse" = ${aiResponse},
              "aiConfidence" = ${confidence},
              "contentRefreshedAt" = NOW()
          WHERE id = ${ticket.id}
        `;

        results.push({
          ticketId: ticket.id,
          subject: ticket.subject,
          confidence,
          success: true,
        });
      } catch (error) {
        console.error(`Error generating AI response for ticket ${ticket.id}:`, error);
        results.push({
          ticketId: ticket.id,
          subject: ticket.subject,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Generated AI responses for ${results.filter(r => r.success).length} out of ${tickets.length} tickets`,
      results,
    });
  } catch (error) {
    console.error('Error in batch AI generation:', error);
    return NextResponse.json(
      { error: 'Failed to generate AI responses' },
      { status: 500 }
    );
  }
}
