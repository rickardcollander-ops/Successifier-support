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

// Staffing knobs are fractions of an hour: accept 0 < n < 1 ("0.8"), or a
// percentage 1 < n < 100 ("80") normalised down — whichever the user typed.
// Anything else clears the value so the app-side default applies.
function optionalFraction(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1) return n;
  if (n < 100) return n / 100;
  return null;
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
      slaFirstResponseHours: settings?.slaFirstResponseHours ?? null,
      staffingOccupancy: settings?.staffingOccupancy ?? null,
      staffingShrinkage: settings?.staffingShrinkage ?? null,
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

    // Partial update: only fields present in the body are touched, so the
    // reports settings form and the bemanning settings form can each save
    // their own fields without clearing the other's. (Sending an empty
    // value still clears that specific field — that's how the UI blanks
    // one to "ej satt".)
    const data: Record<string, number | null> = {};
    if ('agentHourlyCost' in body) data.agentHourlyCost = optionalPositive(body.agentHourlyCost);
    if ('baselineResponseHours' in body) data.baselineResponseHours = optionalPositive(body.baselineResponseHours);
    if ('baselineHandlingMinutes' in body) data.baselineHandlingMinutes = optionalPositive(body.baselineHandlingMinutes);
    if ('slaFirstResponseHours' in body) data.slaFirstResponseHours = optionalPositive(body.slaFirstResponseHours);
    if ('staffingOccupancy' in body) data.staffingOccupancy = optionalFraction(body.staffingOccupancy);
    if ('staffingShrinkage' in body) data.staffingShrinkage = optionalFraction(body.staffingShrinkage);

    const settings = await prisma.reportSettings.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });

    return NextResponse.json({
      agentHourlyCost: settings.agentHourlyCost,
      baselineResponseHours: settings.baselineResponseHours,
      baselineHandlingMinutes: settings.baselineHandlingMinutes,
      slaFirstResponseHours: settings.slaFirstResponseHours,
      staffingOccupancy: settings.staffingOccupancy,
      staffingShrinkage: settings.staffingShrinkage,
    });
  } catch (error) {
    console.error('Error saving report settings:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
