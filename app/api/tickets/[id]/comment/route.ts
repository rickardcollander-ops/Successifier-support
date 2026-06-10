import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { auth } from '@/lib/auth';
import { requireApiAuth } from '@/lib/api-auth';
import { findScopedTicket } from '@/lib/db/scoped';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await params;
    const { text } = await request.json();

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Text krävs' }, { status: 400 });
    }

    let author: string | null = null;
    if (authResult.via === 'session') {
      const session = await auth();
      author = session?.user?.name || authResult.userEmail;
    } else {
      author = 'API';
    }

    const ticket = await findScopedTicket(id);
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
    const authorLabel = author ? ` av ${author}` : '';
    const separator = `\n\n---\n[Intern kommentar ${timestamp}${authorLabel}]\n`;

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { originalMessage: ticket.originalMessage + separator + text.trim() },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error adding comment:', error);
    return NextResponse.json({ error: 'Kunde inte spara kommentaren' }, { status: 500 });
  }
}
