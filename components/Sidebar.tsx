"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { product } from "@/lib/products";
import { t } from "@/lib/i18n";
import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { 
  Menu, 
  X, 
  Ticket, 
  BookOpen, 
  Settings,
  ChevronRight,
  BarChart3,
  Mail,
  Code,
  Shield,
  LogOut
} from "lucide-react";
import ThemeToggle from "./ThemeToggle";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  superadminOnly?: boolean;
  settingsAdminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/developer", label: "Developer", icon: Code, superadminOnly: true },
  { href: "/settings/email-accounts", label: "Email Accounts", icon: Mail, settingsAdminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, settingsAdminOnly: true },
  { href: "/admin", label: "Admin", icon: Shield, superadminOnly: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = useSession();
  const isSuperadmin = session?.user?.role === "superadmin";
  const isSettingsAdmin = Boolean(session?.user?.isSettingsAdmin);

  // Load collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved) setCollapsed(saved === 'true');
  }, []);

  // Save collapsed state to localStorage
  const toggleCollapsed = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    localStorage.setItem('sidebar-collapsed', String(newState));
  };

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const sidebarContent = (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#0B0F1A] via-[#12172A] to-[#1A2140]">
      {/* Logo Header */}
      <div className={`flex items-center justify-between px-5 py-5 ${collapsed ? 'flex-col gap-2' : ''}`}>
        <div className={`flex items-center gap-3 ${collapsed ? 'flex-col' : ''}`}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#7C5CFF] to-[#9F7BFF]">
            <span className="text-white font-bold text-lg">{product.displayName.charAt(0)}</span>
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white">
                {product.displayName}
              </span>
              <span className="text-[10px] text-slate-400">
                Ticket System
              </span>
            </div>
          )}
        </div>
        <div className={`flex items-center gap-1 ${collapsed ? 'flex-col' : ''}`}>
          {!collapsed && <ThemeToggle />}
          <button
            onClick={toggleCollapsed}
            className="hidden md:block p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            title={collapsed ? t('Expandera meny') : t('Minimera meny')}
          >
            <Menu className="h-5 w-5 text-slate-400" />
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.filter((item) =>
            (!item.superadminOnly || isSuperadmin) &&
            (!item.settingsAdminOnly || isSettingsAdmin),
          ).map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`group flex items-center ${collapsed ? 'justify-center' : 'gap-3'} rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    active 
                      ? "bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] text-white shadow-[0_0_15px_rgba(124,92,255,0.4)]" 
                      : "text-[#A3AAC2] hover:bg-[#1E2648] hover:text-[#E8EBF2]"
                  }`}
                  title={collapsed ? item.label : ''}
                >
                  <Icon className={`h-5 w-5 flex-shrink-0 ${
                    active ? "text-white" : "text-[#6F7692] group-hover:text-[#A3AAC2]"
                  }`} />
                  {!collapsed && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {active && (
                        <ChevronRight className="h-4 w-4 text-white/60" />
                      )}
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User & Sign Out */}
      <div className="border-t border-white/10 p-4 space-y-3">
        {session?.user && (
          <div className={`flex items-center gap-3 ${collapsed ? 'flex-col' : ''}`}>
            {session.user.image ? (
              <img src={session.user.image} alt="" className="w-8 h-8 rounded-full" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#7C5CFF] flex items-center justify-center">
                <span className="text-white text-xs font-bold">
                  {(session.user.name || session.user.email || '?')[0].toUpperCase()}
                </span>
              </div>
            )}
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">{session.user.name || session.user.email}</p>
                <p className="text-[10px] text-slate-400 truncate">{session.user.email}</p>
              </div>
            )}
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2'} px-3 py-2 text-xs text-slate-400 hover:text-white hover:bg-[#1E2648] rounded-lg transition-colors`}
          title={collapsed ? t('Logga ut') : ''}
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && t('Logga ut')}
        </button>
        {!collapsed && (
          <div className="text-center text-[10px] text-slate-600">
            Powered by Successifier
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile header */}
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between bg-[#12172A] border-b border-[#2A3360] px-4 py-3 lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-xl hover:bg-[#1E2648] transition-colors"
        >
          <Menu className="h-5 w-5 text-white" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#7C5CFF] to-[#9F7BFF]">
            <span className="text-white font-bold text-xs">{product.displayName.charAt(0)}</span>
          </div>
          <span className="text-sm font-semibold text-white">{product.displayName}</span>
        </div>
        <div className="w-9" /> {/* Spacer for centering */}
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar - hidden on mobile, shown on lg+ */}
      <aside className={`
        fixed top-0 left-0 z-50 flex h-screen flex-col
        transform transition-all duration-300 ease-out
        ${mobileOpen ? 'translate-x-0 w-72' : '-translate-x-full w-72'}
        lg:translate-x-0 ${collapsed ? 'lg:w-20' : 'lg:w-64'}
      `}>
        {sidebarContent}
      </aside>
    </>
  );
}
