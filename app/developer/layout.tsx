'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Shared sub-navigation for the Developer Portal. Without it the docs, SDK
// and webhook pages are dead ends — you could only get back through the
// browser's back button, which is a poor first impression for someone
// evaluating the API.
const TABS = [
  { href: '/developer', label: 'API keys' },
  { href: '/developer/docs', label: 'Documentation' },
  { href: '/developer/webhooks', label: 'Webhooks' },
  { href: '/developer/sdk', label: 'Client & examples' },
];

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-[#7C5CFF] text-[#7C5CFF]'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
        <a
          href="/api/openapi"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto px-4 py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-[#7C5CFF]"
          title="Machine-readable API description (OpenAPI 3.1)"
        >
          OpenAPI spec ↗
        </a>
      </nav>

      {children}
    </div>
  );
}
