'use client';

import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status } = useSession();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  // Logged in: sidebar + main content
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-slate-900 text-zinc-900 dark:text-slate-100 flex">
      <Sidebar />
      <div className={`flex flex-1 flex-col transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'}`}>
        <main className="px-4 py-4 pt-16 lg:pt-6 sm:px-6 lg:px-8 flex-1 page-transition">
          {children}
        </main>
      </div>
    </div>
  );
}
