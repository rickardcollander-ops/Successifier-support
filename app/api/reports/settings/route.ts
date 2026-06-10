import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getTenantId } from '@/lib/products/tenant';
import { requireApiAuth } from '@/lib/api-auth';

async function resolveTenantId(): Promise<string> {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error('Tenant not found');
  return tenantId;
}

// Accept a positive number from the body, else null. Empty string / missing
// / nonsense all clear the value so the UI can blank a field to "ej satt".
function optionalPositive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Read the ROI/report settings (agent hourly cost + baselines). Returns the
// row or null defaults — the client decides what to prompt for.
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await resolveTenantId();
    const settings = await prisma.reportSettings.findUnique({ where: { tenantId } });
    return NextResponse.json({
      agentHourlyCost: settings?.agentHourlyCost ?? null,
      baselineResponseHours: settings?.baselineResponseHours ?? null,
      baselineHandlingMinutes: settings?.baselineHandlingMinutes ?? null,
    });
  } catch (error) {
    console.error('Error fetching report settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// Save the ROI/report settings.
export async function PUT(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const tenantId = await resolveTenantId();
    const body = await request.json();

    const data = {
      agentHourlyCost: optionalPositive(body.agentHourlyCost),
      baselineResponseHours: optionalPositive(body.baselineResponseHours),
      baselineHandlingMinutes: optionalPositive(body.baselineHandlingMinutes),
    };

    const settings = await prisma.reportSettings.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });

    return NextResponse.json({
      agentHourlyCost: settings.agentHourlyCost,
      baselineResponseHours: settings.baselineResponseHours,
      baselineHandlingMinutes: settings.baselineHandlingMinutes,
    });
  } catch (error) {
    console.error('Error saving report settings:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
