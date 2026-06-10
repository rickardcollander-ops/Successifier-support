import type { Metadata } from 'next';
import Link from 'next/link';
import { product } from '@/lib/products';

export const metadata: Metadata = {
  title: `Hjälpcenter – ${product.displayName}`,
  description: `Vanliga frågor, guider och svar för ${product.brandName}.`,
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between">
          <Link href="/help" className="font-semibold text-lg">
            {product.brandName} <span className="text-[#7C5CFF]">Hjälpcenter</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-4xl px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
        © {new Date().getFullYear()} {product.brandName}
      </footer>
    </div>
  );
}
