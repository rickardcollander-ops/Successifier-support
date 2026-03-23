import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/client';
import EmailAccountsClient from '@/components/EmailAccountsClient';
import { auth } from '@/lib/auth';

async function getEmailAccounts() {
  try {
    const accounts = await prisma.emailAccount.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { name: true, email: true },
        },
      },
    });

    return accounts.map(account => ({
      ...account,
      ownerName: account.user?.name || null,
      ownerEmail: account.user?.email || null,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
      lastSyncAt: account.lastSyncAt?.toISOString() || null,
      expiresAt: account.expiresAt?.toISOString() || null,
    }));
  } catch (error) {
    console.error('Error fetching email accounts:', error);
    return [];
  }
}

export default async function EmailAccountsPage() {
  const session = await auth();
  
  if (!session?.user?.email) {
    redirect('/auth/signin');
  }

  const accounts = await getEmailAccounts();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          E-postkonton
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          Hantera e-postkonton för att ta emot kundärenden
        </p>
      </div>

      <EmailAccountsClient initialAccounts={accounts} />

      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
          💡 Tips
        </h3>
        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <li>• E-post från anslutna konton skapas automatiskt som tickets</li>
          <li>• Du kan ansluta flera Gmail-konton för olika support-adresser</li>
          <li>• Synkronisering sker automatiskt var 5:e minut</li>
        </ul>
      </div>
    </div>
  );
}
