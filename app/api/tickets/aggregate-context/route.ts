import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenant } from '@/lib/products/tenant';
import { ContextAggregator } from '@/lib/services/context-aggregator';
import { requireApiAuth, requireSession } from '@/lib/api-auth';

export async function POST() {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    console.log('🔍 Starting context aggregation for all tickets...');

    // Find tenant
    const tenant = await getTenant();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Get all active integrations
    const integrationsRaw = await prisma.integration.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true,
      },
    });

    if (integrationsRaw.length === 0) {
      return NextResponse.json({ error: 'No active integrations found' }, { status: 404 });
    }

    // Cast to Integration type
    const integrations = integrationsRaw as any[];

    // Get all tickets
    const tickets = await prisma.ticket.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`📊 Found ${tickets.length} tickets`);

    const aggregator = new ContextAggregator();
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const ticket of tickets) {
      try {
        const customerEmail = ticket.customerEmail.trim().toLowerCase();
        
        // Skip Billecta's own emails
        if (customerEmail === 'no-reply@billecta.com') {
          skipped++;
          continue;
        }

        console.log(`🔍 Aggregating context for ${customerEmail}...`);

        // Gather context from all integrations
        const context = await aggregator.gatherContext(customerEmail, integrations);

        // Only update if we found some context
        if (Object.keys(context).length > 0) {
          await prisma.ticket.update({
            where: { id: ticket.id },
            data: { contextData: context },
          });

          const billectaInvoices = context.billecta?.invoices?.length || 0;
          const stripeData = context.stripe ? 'Yes' : 'No';
          
          console.log(`✅ Updated ticket #${ticket.id}: Billecta=${billectaInvoices} invoices, Stripe=${stripeData}`);
          updated++;
        } else {
          console.log(`⏭️  No context found for ${customerEmail}`);
          skipped++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`❌ Error processing ticket ${ticket.id}:`, error);
        errors++;
      }
    }

    const summary = {
      total: tickets.length,
      updated,
      skipped,
      errors,
    };

    console.log(`\n📊 Aggregation Summary:`, summary);

    return NextResponse.json({
      success: true,
      summary,
    });

  } catch (error) {
    console.error('❌ Context aggregation failed:', error);
    return NextResponse.json(
      { error: 'Failed to aggregate context', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
