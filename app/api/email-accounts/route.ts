import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Return all email accounts with owner info so everyone can see connected accounts
    const accounts = await prisma.emailAccount.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { name: true, email: true },
        },
      },
    });

    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('Error fetching email accounts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch email accounts' },
      { status: 500 }
    );
  }
}
