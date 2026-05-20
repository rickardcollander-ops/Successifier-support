import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { auth } from '@/lib/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { text } = await request.json();

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Text krävs' }, { status: 400 });
    }

    let author: string | null = null;
    try {
      const session = await auth();
      author = session?.user?.name || session?.user?.email || null;
    } catch {}

    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
    const authorLabel = author ? ` av ${author}` : '';
    const separator = `\n\n---\n[Intern kommentar ${timestamp}${authorLabel}]\n`;

    const updated = await prisma.ticket.update({
      where: { id },
      data: { originalMessage: ticket.originalMessage + separator + text.trim() },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error adding comment:', error);
    return NextResponse.json({ error: 'Kunde inte spara kommentaren' }, { status: 500 });
  }
}
