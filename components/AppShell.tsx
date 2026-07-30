'use client';

import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';

// Platform billing state served by /api/tenant/config (lib/billing.ts).
interface BillingInfo {
  active: boolean;
  blockedReason?: 'trial_expired' | 'canceled' | 'suspended';
  warning?: 'past_due' | 'trial_ending';
  trialEndsAt: string | null;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status, data: session } = useSession();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [billing, setBilling] = useState<BillingInfo | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    fetch('/api/tenant/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.billing) setBilling(data.billing);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status]);

  const isAuthPage = pathname.startsWith('/auth/');
  // The public help center renders its own chrome and must never show the
  // authenticated sidebar, even when an agent happens to be signed in.
  const isPublicPage = pathname === '/help' || pathname.startsWith('/help/');
  const isLoggedIn = status === 'authenticated';

  // Listen for sidebar collapse state changes
  useEffect(() => {
    const checkCollapsed = () => {
      const saved = localStorage.getItem('sidebar-collapsed');
      setSidebarCollapsed(saved === 'true');
    };
    
    checkCollapsed();
    window.addEventListener('storage', checkCollapsed);
    
    // Poll for changes (in case same tab)
    const interval = setInterval(checkCollapsed, 100);
    
    return () => {
      window.removeEventListener('storage', checkCollapsed);
      clearInterval(interval);
    };
  }, []);

  // Auth pages and the public help center: no sidebar, full screen
  if (isAuthPage || isPublicPage || !isLoggedIn) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-slate-900 text-zinc-900 dark:text-slate-100">
        {children}
      </div>
    );
  }

  // Blocked subscription (expired trial, canceled, suspended): lock the
  // agent app with a clear message instead of letting every API call 402.
  // Superadmins keep full access so we can always administrate.
  const isSuperadmin = session?.user?.role === 'superadmin';
  if (billing && !billing.active && !isSuperadmin) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-slate-900 text-zinc-900 dark:text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold">
            {billing.blockedReason === 'trial_expired'
              ? 'Provperioden har löpt ut'
              : 'Prenumerationen är inaktiv'}
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            {billing.blockedReason === 'trial_expired'
              ? 'Er kostnadsfria provperiod är slut. Kontakta oss så aktiverar vi ert abonnemang — all er data finns kvar.'
              : 'Kontot är pausat. Kontakta oss för att återaktivera — all er data finns kvar.'}
          </p>
          <a
            href="mailto:support@successifier.com"
            className="inline-block rounded-lg bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] px-5 py-2.5 text-sm font-medium text-white"
          >
            Kontakta Successifier
          </a>
        </div>
      </div>
    );
  }

  const warningText =
    billing?.warning === 'past_due'
      ? 'Senaste betalningen misslyckades — uppdatera betalmetoden för att undvika avbrott.'
      : billing?.warning === 'trial_ending' && billing.trialEndsAt
        ? `Provperioden slutar ${new Date(billing.trialEndsAt).toLocaleDateString('sv-SE')} — kontakta oss för att aktivera abonnemanget.`
        : null;

  // Logged in: sidebar + main content
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-slate-900 text-zinc-900 dark:text-slate-100 flex">
      <Sidebar />
      <div className={`flex flex-1 flex-col transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'}`}>
        {warningText && (
          <div className="mx-4 mt-16 lg:mt-4 sm:mx-6 lg:mx-8 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
            {warningText}
          </div>
        )}
        <main className={`px-4 py-4 ${warningText ? 'pt-4' : 'pt-16'} lg:pt-6 sm:px-6 lg:px-8 flex-1 page-transition`}>
          {children}
        </main>
      </div>
    </div>
  );
}
