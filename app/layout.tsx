import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../styles/globals.css";
import { Providers } from "./providers";
import AppShell from "@/components/AppShell";
import { getActiveTenantConfig } from "@/lib/products";
import { auth } from "@/lib/auth";
import { resolveTenantForSession } from "@/lib/tenant-switch";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The tenant this render belongs to: a superadmin's active tenant switch,
// then the signed-in user's own tenant, then the host subdomain / env pin.
// Matching what the APIs resolve (lib/tenant-switch.ts) keeps the chrome from
// briefly showing one tenant's branding over another tenant's data.
async function resolveActiveTenant() {
  const session = await auth().catch(() => null);
  return resolveTenantForSession(session?.user);
}

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await resolveActiveTenant();
  const config = ctx?.config ?? getActiveTenantConfig();
  return {
    title: `${config.displayName} - Ticket Management`,
    description: "AI-powered customer support",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the request's tenant server-side and hand the config to the
  // client provider so client components render with the right tenant's
  // branding from the first paint.
  const ctx = await resolveActiveTenant();
  const tenantConfig = ctx?.config ?? getActiveTenantConfig();
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers tenantConfig={tenantConfig}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
